// Passkeys (WebAuthn) with @simplewebauthn/server. Each ceremony is a stored challenge, spent once.
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticationResponseJSON, AuthenticatorTransport, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Context } from "hono";
import { sha256, type AppEnv } from "./auth";

export const RP_NAME = "EELS Data Base";
export const MAX_PASSKEYS = 20;
const CHALLENGE_MINUTES = 5;
type C = Context<AppEnv>;
type Kind = "register" | "sign_in" | "second_step";

const toB64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (text: string) => {
  const b = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (ch) => ch.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
};

const rp = (c: C) => {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin };
};

export const hasPasskey = async (db: D1Database, userId: number) => !!(await db.prepare("SELECT 1 FROM passkeys WHERE user_id = ? LIMIT 1").bind(userId).first());

async function storeChallenge(c: C, kind: Kind, userId: number | null, challenge: string) {
  const token = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM webauthn_challenges WHERE expires_at < ?").bind(new Date().toISOString()),
    c.env.DB.prepare("INSERT INTO webauthn_challenges (token_hash, user_id, challenge, kind, expires_at) VALUES (?, ?, ?, ?, ?)")
      .bind(await sha256(token), userId, challenge, kind, new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString()),
  ]);
  return token;
}

/** Spends the challenge: it works once, only for its kind, and only for the user it was made for. */
const takeChallenge = (c: C, token: unknown, kind: Kind, userId: number | null) =>
  typeof token !== "string"
    ? null
    : sha256(token).then((hash) =>
        c.env.DB.prepare("DELETE FROM webauthn_challenges WHERE token_hash = ? AND kind = ? AND user_id IS ? AND expires_at > ? RETURNING challenge")
          .bind(hash, kind, userId, new Date().toISOString()).first<string>("challenge"));

const credentialsOf = async (db: D1Database, userId: number) =>
  (await db.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").bind(userId).all<{ credential_id: string; transports: string | null }>()).results.map((p) => ({
    id: p.credential_id,
    transports: (p.transports ? JSON.parse(p.transports) : undefined) as AuthenticatorTransport[] | undefined,
  }));

export async function registrationOptions(c: C, user: { id: number; display_name: string }) {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp(c).rpID,
    userName: user.display_name,
    userID: new Uint8Array(new TextEncoder().encode(`eelsdb:${user.id}`)),
    attestationType: "none",
    excludeCredentials: await credentialsOf(c.env.DB, user.id),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { options, token: await storeChallenge(c, "register", user.id, options.challenge) };
}

export async function addPasskey(c: C, userId: number, token: unknown, response: RegistrationResponseJSON, name: string) {
  const expectedChallenge = await takeChallenge(c, token, "register", userId);
  if (!expectedChallenge) return false;
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response, expectedChallenge, expectedOrigin: rp(c).origin, expectedRPID: rp(c).rpID, requireUserVerification: true,
    });
    if (!verified || !registrationInfo) return false;
    const { credential } = registrationInfo;
    await c.env.DB.prepare("INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(credential.id, userId, toB64u(credential.publicKey), credential.counter, credential.transports ? JSON.stringify(credential.transports) : null, name).run();
    return true;
  } catch {
    return false;
  }
}

/** `userId` limits the options to that user's passkeys (second step); without it any discoverable passkey can answer. */
export async function authenticationOptions(c: C, kind: "sign_in" | "second_step", userId: number | null) {
  const options = await generateAuthenticationOptions({
    rpID: rp(c).rpID,
    userVerification: "required",
    allowCredentials: userId === null ? undefined : await credentialsOf(c.env.DB, userId),
  });
  return { options, token: await storeChallenge(c, kind, userId, options.challenge) };
}

/** Checks an assertion and returns the passkey's user, or null. For a second step it must be a passkey of `userId`. */
export async function verifyPasskey(c: C, kind: "sign_in" | "second_step", userId: number | null, token: unknown, response: AuthenticationResponseJSON) {
  const expectedChallenge = await takeChallenge(c, token, kind, userId);
  if (!expectedChallenge || typeof response?.id !== "string") return null;
  const key = await c.env.DB.prepare("SELECT user_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?")
    .bind(response.id).first<{ user_id: number; public_key: string; counter: number; transports: string | null }>();
  if (!key || (userId !== null && key.user_id !== userId)) return null;
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: rp(c).origin,
      expectedRPID: rp(c).rpID,
      requireUserVerification: true,
      credential: { id: response.id, publicKey: fromB64u(key.public_key), counter: key.counter, transports: key.transports ? JSON.parse(key.transports) : undefined },
    });
    if (!verified) return null;
    await c.env.DB.prepare("UPDATE passkeys SET counter = ?, last_used_at = datetime('now') WHERE credential_id = ?").bind(authenticationInfo.newCounter, response.id).run();
    return key.user_id;
  } catch {
    return null;
  }
}

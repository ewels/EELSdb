// TOTP (RFC 6238) and recovery codes, with Web Crypto only.
import { sha256 } from "./auth";

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD = 30;
export const MAX_SECOND_STEP_FAILURES = 10;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function base32Encode(bytes: Uint8Array) {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    for (; bits >= 5; bits -= 5) out += B32[(value >>> (bits - 5)) & 31];
  }
  if (bits) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string) {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, "")) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

export const newSecret = () => base32Encode(crypto.getRandomValues(new Uint8Array(20)));

/** The code for one time step; `digits` is a parameter so the RFC's 8-digit test vectors can be checked. */
export async function totpCode(secret: string, step: number, digits = TOTP_DIGITS) {
  const key = await crypto.subtle.importKey("raw", base32Decode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(step));
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_PERIOD);

/** The matching step within one step either side of now, only if it is newer than `lastStep` (a code works once). */
export async function matchingStep(secret: string, code: string, lastStep: number, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastStep && (await totpCode(secret, step)) === code) return step;
  }
  return null;
}

export const otpauthUri = (secret: string, account: string) =>
  `otpauth://totp/${encodeURIComponent(`EELSdb:${account}`)}?${new URLSearchParams({ secret, issuer: "EELSdb", algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD) })}`;

const normalizeRecovery = (code: string) => code.toLowerCase().replace(/[\s-]/g, "");

function newRecoveryCode() {
  const pick = () => RECOVERY_ALPHABET[crypto.getRandomValues(new Uint8Array(1))[0] % RECOVERY_ALPHABET.length];
  const chars = Array.from({ length: 10 }, pick).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** Replaces the user's recovery codes with 10 new ones and returns them: this is the only time they can be shown. */
export async function makeRecoveryCodes(db: D1Database, userId: number) {
  const codes = Array.from({ length: 10 }, newRecoveryCode);
  await db.batch([
    db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(userId),
    ...(await Promise.all(codes.map(async (c) => db.prepare("INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)").bind(userId, await sha256(normalizeRecovery(c)))))),
  ]);
  return codes;
}

/** An authenticator app or a passkey: either one is a second step, and either one satisfies the moderator rule. */
export const hasTwoStep = async (db: D1Database, userId: number) =>
  !!(await db.prepare("SELECT 1 FROM user_totp WHERE user_id = ? AND enabled_at IS NOT NULL UNION ALL SELECT 1 FROM passkeys WHERE user_id = ?").bind(userId, userId).first());

/**
 * Checks an authenticator code or a recovery code for an account with two-step sign-in on, and spends it.
 * Wrong answers count towards a limit of 10 an hour per account, shared by every place that asks for a code.
 */
export async function spendCode(db: D1Database, userId: number, input: unknown): Promise<"ok" | "wrong" | "locked"> {
  const key = String(userId);
  const failures = await db.prepare("SELECT COUNT(*) AS n FROM rate_events WHERE kind = 'second_step' AND key = ? AND at > datetime('now', '-1 hour')").bind(key).first<number>("n");
  if ((failures ?? 0) >= MAX_SECOND_STEP_FAILURES) return "locked";
  const code = typeof input === "string" ? input.trim() : "";
  const row = await db.prepare("SELECT secret, last_step FROM user_totp WHERE user_id = ? AND enabled_at IS NOT NULL").bind(userId).first<{ secret: string; last_step: number }>();
  if (row && code.length <= 40) {
    const digits = code.replace(/\s/g, "");
    const step = await matchingStep(row.secret, digits, row.last_step);
    // The conditional update is what stops two requests from spending the same step.
    if (step !== null && (await db.prepare("UPDATE user_totp SET last_step = ? WHERE user_id = ? AND last_step < ?").bind(step, userId, step).run()).meta.changes === 1) return "ok";
    if (!/^\d+$/.test(digits)) {
      const used = await db.prepare("UPDATE recovery_codes SET used_at = datetime('now') WHERE user_id = ? AND code_hash = ? AND used_at IS NULL")
        .bind(userId, await sha256(normalizeRecovery(code))).run();
      if (used.meta.changes === 1) return "ok";
    }
  }
  await db.prepare("INSERT INTO rate_events (kind, key) VALUES ('second_step', ?)").bind(key).run();
  return "wrong";
}

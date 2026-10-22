// A software WebAuthn authenticator (ES256, "none" attestation) built on Web Crypto, so tests send the Worker real
// registration and assertion responses.
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const sha = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
const text = (s: string) => new TextEncoder().encode(s);

function cborHead(major: number, n: number) {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 256) return Uint8Array.of((major << 5) | 24, n);
  return Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
}
type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;
function cbor(v: Cbor): Uint8Array {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") return concat(cborHead(3, text(v).length), text(v));
  if (v instanceof Uint8Array) return concat(cborHead(2, v.length), v);
  return concat(cborHead(5, v.size), ...[...v].flatMap(([k, val]) => [cbor(k), cbor(val)]));
}

// WebCrypto signs ECDSA as raw r||s; WebAuthn wants an ASN.1 DER sequence of two integers.
function derSignature(raw: Uint8Array) {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const body = b[i] & 0x80 ? concat(Uint8Array.of(0), b.slice(i)) : b.slice(i);
    return concat(Uint8Array.of(0x02, body.length), body);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(Uint8Array.of(0x30, body.length), body);
}

const U32 = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const UP = 0x01, UV = 0x04, AT = 0x40;

export class SoftwareAuthenticator {
  credentialId = crypto.getRandomValues(new Uint8Array(32));
  counter = 0;
  private keys!: CryptoKeyPair;
  constructor(public rpId = "eelsdb.eu", public origin = "https://eelsdb.eu", public userVerified = true) {}

  get id() { return b64u(this.credentialId); }

  private flags(extra = 0) { return (this.userVerified ? UP | UV : UP) | extra; }

  private async clientData(type: string, challenge: string, origin = this.origin) {
    return text(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  async register(options: { challenge: string }, over: { origin?: string } = {}) {
    this.keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const cose = cbor(new Map<number, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, fromB64u(jwk.x!)], [-3, fromB64u(jwk.y!)]]));
    const authData = concat(await sha(text(this.rpId)), Uint8Array.of(this.flags(AT)), U32(this.counter), new Uint8Array(16), Uint8Array.of(0, this.credentialId.length), this.credentialId, cose);
    const attestationObject = cbor(new Map<string, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(await this.clientData("webauthn.create", options.challenge, over.origin)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
    };
  }

  async assert(options: { challenge: string }, over: { counter?: number; origin?: string; type?: string } = {}) {
    this.counter = over.counter ?? this.counter + 1;
    const clientData = await this.clientData(over.type ?? "webauthn.get", options.challenge, over.origin);
    const authData = concat(await sha(text(this.rpId)), Uint8Array.of(this.flags()), U32(this.counter));
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, concat(authData, await sha(clientData)) as BufferSource));
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      clientExtensionResults: {},
      response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(derSignature(signature)) },
    };
  }
}

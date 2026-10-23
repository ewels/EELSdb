// Verifies passwords against hashes migrated from WordPress. Only used when LEGACY_PASSWORD_LOGIN is "1":
// phpass and bcrypt are CPU-heavy, so each hash is replaced with PBKDF2 on first use.
import bcrypt from "bcryptjs";

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const enc = new TextEncoder();

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

const md5 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("MD5", data));

/** phpass's own base64 variant. */
function encode64(input: Uint8Array, count: number) {
  let out = "";
  let i = 0;
  do {
    let value = input[i++];
    out += ITOA64[value & 0x3f];
    if (i < count) value |= input[i] << 8;
    out += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    out += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    out += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return out;
}

/** Portable phpass hashes ($P$ / $H$), as WordPress used before 6.8. */
export async function phpassHash(password: string, setting: string) {
  const countLog2 = ITOA64.indexOf(setting[3]);
  if (countLog2 < 7 || countLog2 > 30) return null;
  const salt = setting.slice(4, 12);
  if (salt.length !== 8) return null;
  const pw = enc.encode(password);
  let hash = await md5(concat(enc.encode(salt), pw));
  for (let n = 1 << countLog2; n > 0; n--) hash = await md5(concat(hash, pw));
  return setting.slice(0, 12) + encode64(hash, 16);
}

async function wpPrehash(password: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode("wp-sha384"), { name: "HMAC", hash: "SHA-384" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(password.trim())));
  return btoa(String.fromCharCode(...mac));
}

const PBKDF2_ITERATIONS = 100_000; // the most Workers allows
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** The format legacy passwords are rehashed to after a successful sign-in. */
export async function pbkdf2Hash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `$pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

function sameString(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyLegacyPassword(password: string, hash: string): Promise<boolean> {
  if (hash.startsWith("$pbkdf2-sha256$")) {
    const [, , iterations, salt, expected] = hash.split("$");
    const salted = Uint8Array.from(atob(salt), (ch) => ch.charCodeAt(0));
    return sameString(b64(await pbkdf2(password, salted, Number(iterations))), expected);
  }
  if (hash.startsWith("$wp$")) return bcrypt.compare(await wpPrehash(password), hash.slice(3));
  if (/^\$2[aby]\$/.test(hash)) return bcrypt.compare(password, hash);
  if (hash.startsWith("$P$") || hash.startsWith("$H$")) {
    const computed = await phpassHash(password, hash);
    return computed !== null && sameString(computed, hash);
  }
  return false;
}

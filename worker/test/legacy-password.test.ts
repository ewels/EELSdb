import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { pbkdf2Hash, verifyLegacyPassword } from "../src/legacy-password";

// Generated with passlib (phpass) and the Python bcrypt package, not with this code.
const PHPASS = "$P$BabcdefghKfdE7H4Uy7ajxpijsjAJW0";
const WP_BCRYPT = "$wp$2y$04$.sLjjEzax1CSx3EL4GWoAeD9cOsZJo.TavMPA2ua55JfINmzSQUiy";
const BCRYPT = "$2b$04$Y65bD2bQwzw1PdrH4xO9ce.AQh12kQxXztCrt432LRlCTPmRHV5Au";

describe("legacy password hashes", () => {
  it.each([PHPASS, WP_BCRYPT, BCRYPT])("verifies %s", async (hash) => {
    expect(await verifyLegacyPassword("correct horse", hash)).toBe(true);
    expect(await verifyLegacyPassword("wrong horse", hash)).toBe(false);
  });

  it("WordPress trims the password before hashing", async () => {
    expect(await verifyLegacyPassword(" correct horse ", WP_BCRYPT)).toBe(true);
  });

  it("rehashes to PBKDF2", async () => {
    const hash = await pbkdf2Hash("correct horse");
    expect(hash).toMatch(/^\$pbkdf2-sha256\$100000\$/);
    expect(await verifyLegacyPassword("correct horse", hash)).toBe(true);
    expect(await verifyLegacyPassword("correct horsf", hash)).toBe(false);
  });

  it("rejects unknown formats", async () => {
    expect(await verifyLegacyPassword("x", "plaintext")).toBe(false);
  });
});

describe("password sign-in", () => {
  it("signs in, then stores a PBKDF2 hash instead of the WordPress one", async () => {
    await env.DB.prepare("INSERT INTO users (id, display_name, legacy_login, legacy_email, legacy_password_hash) VALUES (7000001, 'Pw User', 'pwuser', 'pw@lab.org', ?)")
      .bind(PHPASS)
      .run();
    const login = (password: string, user = "PW@lab.org") =>
      exports.default.fetch("https://eelsdb.eu/login/password/", {
        method: "POST",
        redirect: "manual",
        headers: { Origin: "https://eelsdb.eu", "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ login: user, password, next: "/spectra/" }).toString(),
      });
    expect((await login("nope")).headers.get("location")).toBe("/login/?error=password");
    const ok = await login("correct horse");
    expect(ok.headers.get("location")).toBe("/spectra/");
    expect(ok.headers.getSetCookie().some((c) => c.startsWith("eelsdb_session="))).toBe(true);
    expect(await env.DB.prepare("SELECT legacy_password_hash FROM users WHERE id = 7000001").first("legacy_password_hash")).toMatch(/^\$pbkdf2/);
    expect((await login("correct horse", "pwuser")).headers.get("location")).toBe("/spectra/");
  });
});

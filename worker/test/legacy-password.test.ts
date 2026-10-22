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

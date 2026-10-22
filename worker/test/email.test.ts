import { describe, expect, it } from "vitest";
import { FOOTER, sendEmail, sent } from "../src/email";

const email = { to: "a@lab.org", subject: "Hello", text: "Body" };

describe("sendEmail", () => {
  it("log provider keeps the message with the footer", async () => {
    const before = sent.length;
    await sendEmail({ EMAIL_PROVIDER: "log" } as Env, email);
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)).toEqual({ ...email, text: `Body\n\n-- \nEELS Data Base, https://eelsdb.eu\n${FOOTER}` });
  });

  it("cloudflare provider passes from, to, subject and text to the binding", async () => {
    const calls: unknown[] = [];
    const env = { EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "noreply@eelsdb.eu", EMAIL: { send: async (m: unknown) => void calls.push(m) } } as unknown as Env;
    await sendEmail(env, email);
    expect(calls).toEqual([{ from: { email: "noreply@eelsdb.eu", name: "EELSdb" }, to: "a@lab.org", subject: "Hello", text: `Body\n\n-- \nEELS Data Base, https://eelsdb.eu\n${FOOTER}` }]);
  });

  it("cloudflare provider needs EMAIL_FROM; unknown providers throw", async () => {
    await expect(sendEmail({ EMAIL_PROVIDER: "cloudflare" } as Env, email)).rejects.toThrow("EMAIL_FROM");
    await expect(sendEmail({ EMAIL_PROVIDER: "x" } as Env, email)).rejects.toThrow("not implemented");
  });
});

export type Email = { to: string; subject: string; text: string; replyTo?: string; footer?: string };

/**
 * Sends a plain-text email with a standard footer. EMAIL_PROVIDER "log" (default) writes it to the Worker log
 * and keeps it in `sent` for tests; "cloudflare" sends through the EMAIL binding from EMAIL_FROM.
 */
export const sent: Email[] = [];

export const FOOTER = "You received this email because this address was used on eelsdb.eu. If that was not you, you can ignore it.";

export async function sendEmail(env: Env, { footer = FOOTER, ...email }: Email) {
  const message = { ...email, text: `${email.text}\n\n-- \nEELS Data Base, https://eelsdb.eu\n${footer}` };
  const provider = env.EMAIL_PROVIDER || "log";
  if (provider === "cloudflare") {
    if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set");
    await env.EMAIL.send({ from: { email: env.EMAIL_FROM, name: "EELSdb" }, to: message.to, subject: message.subject, text: message.text, ...(message.replyTo && { replyTo: message.replyTo }) });
    return;
  }
  if (provider !== "log") throw new Error(`Email provider '${provider}' is not implemented`);
  sent.push(message);
  console.log(`[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
}

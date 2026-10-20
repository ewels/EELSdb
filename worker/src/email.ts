export type Email = { to: string; subject: string; text: string };

/**
 * Sends an email. Only the "log" implementation exists so far: it writes the message to the Worker log
 * (and keeps it in `sent` for tests). Set EMAIL_PROVIDER once a provider is chosen.
 */
export const sent: Email[] = [];

export async function sendEmail(env: Env, email: Email) {
  const provider = env.EMAIL_PROVIDER || "log";
  if (provider !== "log") throw new Error(`Email provider '${provider}' is not implemented`);
  sent.push(email);
  console.log(`[email] to=${email.to} subject=${JSON.stringify(email.subject)}\n${email.text}`);
}

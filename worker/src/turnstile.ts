export async function turnstileOk(env: Env, ip: string | undefined, token: string | null) {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // not configured (local development)
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret, response: token, remoteip: ip ?? "" }),
  });
  return ((await res.json<{ success: boolean }>()).success) === true;
}

import { env } from "cloudflare:workers";
import { sha256 } from "../../src/auth";

/** A signed-in user without going through OAuth: returns the Cookie header value. */
export async function sessionFor(user: { id: number; display_name: string; role?: string; slug?: string | null }) {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, display_name, role, slug) VALUES (?, ?, ?, ?)")
    .bind(user.id, user.display_name, user.role ?? "user", user.slug ?? null)
    .run();
  const token = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), user.id, new Date(Date.now() + 86400_000).toISOString())
    .run();
  return `eelsdb_session=${token}`;
}

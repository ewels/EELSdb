import type { Context } from "hono";
import type { AppEnv } from "./auth";
import { isModerator } from "./instruments";

const TYPES: Record<string, string> = {
  msa: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  dm3: "application/octet-stream",
  dm4: "application/octet-stream",
  hspy: "application/x-hdf5",
};

/**
 * Serves files from R2 at their key: legacy download URLs (/wp-content/uploads/…) as they were, and newer
 * files (/files/…, /submissions/…) once their spectrum is published (before that, to its submitter and moderators).
 */
export async function serveFile(c: Context<AppEnv>) {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice(1));
  if (!key.startsWith("wp-content/")) {
    const s = await c.env.DB.prepare("SELECT s.status, s.owner_id FROM files f JOIN spectra s ON s.id = f.spectrum_id WHERE f.r2_key = ?")
      .bind(key)
      .first<{ status: string; owner_id: number | null }>();
    const user = c.get("user");
    const allowed = s && (s.status === "published" || (user && (user.id === s.owner_id || isModerator(user))));
    if (!allowed) return c.notFound();
  }
  const object = await c.env.FILES.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", TYPES[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream");
  }
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=86400");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(object.body, { headers });
}

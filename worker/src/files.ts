import type { Context } from "hono";
import type { AppEnv } from "./auth";
import { isModerator } from "./instruments";

const TYPES: Record<string, string> = {
  msa: "text/plain; charset=utf-8",
  emsa: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  xdi: "text/plain; charset=utf-8",
  hspy: "application/x-hdf5",
  emd: "application/x-hdf5",
  zip: "application/zip",
};

/**
 * The media type for a stored file, from its extension only. Never from what the uploader sent: a
 * "text/html" upload would otherwise run as a page on this site.
 */
export const mediaType = (name: string) => TYPES[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** A Content-Disposition value that is safe for any file name. */
export function attachment(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Headers for serving uploaded content: the right type, never rendered as a page. */
export function fileHeaders(name: string) {
  return {
    "Content-Type": mediaType(name),
    "Content-Disposition": attachment(name),
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * Serves files from R2 at their key: legacy download URLs (/wp-content/uploads/…) as they were, and newer
 * files (/files/…, /submissions/…) once their spectrum is published (before that, to its submitter and moderators).
 */
export async function serveFile(c: Context<AppEnv>) {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice(1));
  const legacy = key.startsWith("wp-content/");
  if (!legacy) {
    const s = await c.env.DB.prepare("SELECT s.status, s.owner_id FROM files f JOIN spectra s ON s.id = f.spectrum_id WHERE f.r2_key = ?")
      .bind(key)
      .first<{ status: string; owner_id: number | null }>();
    const user = c.get("user");
    const allowed = s && (s.status === "published" || (user && (user.id === s.owner_id || isModerator(user))));
    if (!allowed) return c.notFound();
  }
  const object = await c.env.FILES.get(key);
  if (!object) return c.notFound();
  const name = key.split("/").pop()!;
  const headers = new Headers(fileHeaders(name));
  // Old download links opened in the browser as text; keep that, still sandboxed.
  if (legacy) headers.delete("Content-Disposition");
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", legacy || !key.startsWith("submissions/") ? "public, max-age=86400" : "private, no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(object.body, { headers });
}

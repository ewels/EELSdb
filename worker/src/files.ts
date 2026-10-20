import type { Context } from "hono";

const TYPES: Record<string, string> = {
  msa: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  dm3: "application/octet-stream",
  dm4: "application/octet-stream",
  hspy: "application/x-hdf5",
};

/** Serves legacy download URLs (/wp-content/uploads/…) from R2 at the same paths. */
export async function serveFile(c: Context<{ Bindings: Env }>) {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice(1));
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

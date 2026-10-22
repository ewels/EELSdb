import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { formatV1, loadBundle } from "../src/api/format";

// The typed columns keep numbers, not the strings people typed ("1.0", ".04", "0.090").
const UNIT_FIELDS = ["resolution", "integratetime", "probesize", "thickness", "beamenergy", "convergence", "collection", "stepSize"];
const same = (key: string, a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b) ||
  (UNIT_FIELDS.includes(key) && typeof a === "string" && typeof b === "string" && parseFloat(a) === parseFloat(b));

// The import leaves out the old site's "imported from old site" keyword and its links to the first database, which
// is gone (python/build_seed.py); the recorded objects still have them.
function withoutDropped(v1: any) {
  const out = { ...v1 };
  if (out.keywords) out.keywords = out.keywords.filter((k: string) => k.trim().toLowerCase() !== "imported from old site");
  if (out.other_links) out.other_links = out.other_links.filter((l: any) => !/^https?:\/\/pc-web\.cemes\.fr\//.test(l.url));
  for (const key of ["keywords", "other_links"]) if (Array.isArray(out[key]) && !out[key].length) delete out[key];
  return out;
}

it("formats migrated spectra like their recorded v1 objects", async () => {
  const { results } = await env.DB.prepare("SELECT id, legacy_v1 FROM spectra WHERE legacy_v1 IS NOT NULL ORDER BY id").all<{ id: number; legacy_v1: string }>();
  const diffs: Record<string, number> = {};
  for (const row of results) {
    const expected = withoutDropped(JSON.parse(row.legacy_v1));
    const actual = formatV1((await loadBundle(env.DB, row.id))!);
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      if (!same(key, expected[key], actual[key])) {
        const tag = `${key}: ${JSON.stringify(expected[key])} -> ${JSON.stringify(actual[key])}`;
        diffs[tag] = (diffs[tag] ?? 0) + 1;
      }
    }
  }
  // WordPress gave one associated spectrum a null type; the formatter uses the spectrum's real type.
  expect(Object.keys(diffs)).toEqual([expect.stringMatching(/^associated_spectra: .*titanium-dioxide-5.*"type":null/)]);
});

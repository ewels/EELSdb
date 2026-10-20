import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("holds the 290 published spectra by type", async () => {
  const { results } = await env.DB.prepare(
    "SELECT type, COUNT(*) AS n FROM spectra WHERE status = 'published' GROUP BY type",
  ).all<{ type: string; n: number }>();
  expect(Object.fromEntries(results.map((r) => [r.type, r.n]))).toEqual({
    coreloss: 188,
    lowloss: 80,
    xrayabs: 21,
    zeroloss: 1,
  });
});

it("keeps legacy IDs, slugs and file paths", async () => {
  const row = await env.DB.prepare(
    "SELECT s.id, s.slug, f.r2_key FROM spectra s JOIN files f ON f.spectrum_id = s.id WHERE s.id = 22236",
  ).first();
  expect(row).toEqual({ id: 22236, slug: "mlc-nanotube-ylas-tas2", r2_key: "wp-content/uploads/2023/10/Y20.txt" });
});

it("copies the beamline of X-ray absorption spectra", async () => {
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM xas_acquisition WHERE beamline IS NOT NULL").first("n");
  expect(n).toBe(21);
});

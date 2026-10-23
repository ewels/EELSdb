import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("holds the 290 migrated spectra by type", async () => {
  const { results } = await env.DB.prepare(
    "SELECT type, COUNT(*) AS n FROM spectra WHERE status = 'published' AND phase != 'gas' GROUP BY type",
  ).all<{ type: string; n: number }>();
  expect(Object.fromEntries(results.map((r) => [r.type, r.n]))).toEqual({
    coreloss: 188,
    lowloss: 80,
    xrayabs: 21,
    zeroloss: 1,
  });
});

it("holds the 666 Corex gas-phase spectra, CC0, with oscillator-strength versions", async () => {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n, SUM(licence = 'CC0-1.0') AS cc0, SUM(type = 'coreloss') AS coreloss,
            (SELECT COUNT(*) FROM files f JOIN spectra g ON g.id = f.spectrum_id WHERE g.phase = 'gas' AND f.variant = 'os') AS os
     FROM spectra WHERE phase = 'gas' AND status = 'published'`,
  ).first();
  expect(row).toEqual({ n: 666, cc0: 666, coreloss: 666, os: 664 });
});

it("gives every spectrum a licence, ODbL for those from the old site", async () => {
  const row = await env.DB.prepare(
    "SELECT SUM(licence IS NULL) AS missing, SUM(phase != 'gas' AND licence != 'ODbL-1.0') AS other FROM spectra",
  ).first();
  expect(row).toEqual({ missing: 0, other: 0 });
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

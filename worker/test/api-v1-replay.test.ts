// Replays every recorded live API request against the Worker and compares status and parsed JSON.
// Differences are allowed only where data/fixtures/api-v1/EXPECTED_DIFFS.md lists them.
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import expectedDiffsMd from "../../data/fixtures/api-v1/EXPECTED_DIFFS.md?raw";

type Fixture = {
  request: { path: string; query: string };
  status: number;
  body?: any;
  body_ids?: number[];
};

const files = import.meta.glob<Fixture>("../../data/fixtures/api-v1/**/*.json", { eager: true, import: "default" });
const fixtures = Object.fromEntries(
  Object.entries(files).map(([path, f]) => [path.replace(/^.*api-v1\//, "").replace(/\.json$/, ""), f]),
);
const canonical = new Map<number, any>(fixtures["spectra/all"].body.map((s: any) => [s.id, s]));

const allowed: {
  differs: Record<string, string>;
  membership: Record<string, string>;
  ties: Record<string, string>;
  same_as: Record<string, string>;
  energy_affected: string[];
  corrected_energy: number[];
} = JSON.parse(expectedDiffsMd.match(/```json\n([\s\S]*?)```/)![1]);

// v1 fields that show the value WordPress sorted on, for checking order where tie order is arbitrary.
const num = (v: string | undefined) => (v === undefined ? 0 : parseFloat(v));
const SORT_FIELDS: Record<string, (s: any) => unknown> = {
  title: (s) => s.title.toLowerCase(),
  date: (s) => s.published,
  spectrumMin: (s) => num(s.min_energy),
  spectrumMax: (s) => num(s.max_energy),
  beamenergy: (s) => num(s.beamenergy),
  resolution: (s) => num(s.resolution),
  spectrumType: (s) => s.type,
  spectrumFormula: (s) => s.formula.toLowerCase(),
  ref_year: (s) => s.reference?.year,
  monochromated: (s) => s.monochromated,
  microscope: (s) => s.microscope.toLowerCase(),
};

/** Drop deliberately changed fields (corrected energies, links to private spectra) so the rest is still compared. */
function normalise(body: any): any {
  if (Array.isArray(body)) return body.map(normalise);
  if (!body || typeof body !== "object" || !("download_link" in body)) return body;
  let out = body;
  if (allowed.corrected_energy.includes(body.id)) {
    const { min_energy, max_energy, ...rest } = out;
    out = rest;
  }
  if (out.associated_spectra) {
    const { associated_spectra, ...rest } = out;
    const kept = associated_spectra.filter((a: any) => !a.link.includes("?post_type="));
    out = kept.length ? { ...rest, associated_spectra: kept } : rest;
  }
  return out;
}

async function replay(f: Fixture) {
  const url = `https://api.eelsdb.eu${f.request.path}${f.request.query ? `?${f.request.query}` : ""}`;
  const res = await exports.default.fetch(url);
  return { status: res.status, body: await res.json<any>() };
}

describe("API v1 replay", () => {
  const names = Object.keys(fixtures).filter((n) => n !== "root-noredirect");

  it("has every listed difference among the fixtures", () => {
    const listed = [allowed.differs, allowed.membership, allowed.ties, allowed.same_as].flatMap(Object.keys);
    for (const name of [...listed, ...Object.values(allowed.same_as), ...allowed.energy_affected]) {
      expect(fixtures, name).toHaveProperty([name]);
    }
  });

  it.each(names)("%s", async (name) => {
    const f = fixtures[name];
    if (allowed.differs[name]) return;
    const source = fixtures[allowed.same_as[name] ?? name];
    let expected = source.body_ids ? source.body_ids.map((id) => canonical.get(id)) : source.body;
    const actual = await replay(f);
    expect(actual.status).toBe(f.status);
    if (allowed.energy_affected.includes(name)) {
      const kept = (s: any) => !allowed.corrected_energy.includes(s.id);
      expected = expected.filter(kept);
      actual.body = actual.body.filter(kept);
    }

    if (allowed.membership[name]) {
      return;
    }
    if (allowed.ties[name]) {
      const key = new URLSearchParams(f.request.query).get("order")!;
      const field = SORT_FIELDS[key];
      expect(actual.body.map((s: any) => s.id).sort()).toEqual(expected.map((s: any) => s.id).sort());
      expect(actual.body.map(field)).toEqual(expected.map(field));
      return;
    }
    expect(normalise(actual.body)).toEqual(normalise(expected));
  });
});

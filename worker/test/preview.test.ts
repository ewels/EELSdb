import { describe, expect, it } from "vitest";
import { makePreview } from "../src/preview";

describe("makePreview", () => {
  it("averages into buckets and scales to 0–100", () => {
    const text = Array.from({ length: 300 }, (_, i) => `${100 + i}\t${i < 150 ? 5 : 25}`).join("\n");
    const p = makePreview(text)!;
    expect(p.e).toEqual([100, 399]);
    expect(p.y).toHaveLength(150);
    expect(p.y[0]).toBe(0);
    expect(p.y[149]).toBe(100);
  });

  it("keeps short spectra whole and rejects empty ones", () => {
    expect(makePreview("1 2\n2 4\n3 3")!.y).toEqual([0, 100, 50]);
    expect(makePreview("#FORMAT : EMSA/MAS Spectral Data File\n")).toBeNull();
  });
});

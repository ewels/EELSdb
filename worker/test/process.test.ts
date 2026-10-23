import { describe, expect, it } from "vitest";
import fixture from "../../data/fixtures/process.json";
// @ts-expect-error plain browser module, no types
import { powerLaw, processSpectrum, savitzkyGolay } from "../public/process.js";

const close = (got: number[], want: number[]) => {
  expect(got).toHaveLength(want.length);
  const scale = Math.max(...want.map(Math.abs));
  got.forEach((v, i) => expect(Math.abs(v - want[i]) / scale).toBeLessThan(1e-9));
};

describe("spectrum processing matches exSpy", () => {
  it("removes a power-law background like remove_background", () => {
    const [lo, hi] = fixture.background_window;
    const bg = powerLaw(fixture.x, fixture.y, lo, hi)!;
    close(fixture.y.map((v, i) => v - bg[i]), fixture.remove_background);
    close(processSpectrum(fixture.x, fixture.y, { background: "subtract", window: [lo, hi], smooth: 0, normalise: "" }).y, fixture.remove_background);
  });

  it("smooths like smooth_savitzky_golay", () => {
    close(savitzkyGolay(fixture.y, fixture.smooth.window_length, fixture.smooth.polynomial_order), fixture.smooth_savitzky_golay);
  });

  it("gives no background when the energies cannot be fitted", () => {
    expect(powerLaw([-2, -1, 0, 1, 2], [1, 2, 3, 2, 1], -2, 2)).toBeNull();
    expect(powerLaw([1, 2, 3], [3, 2, 1], 3, 3)).toBeNull();
  });

  it("normalises the processed spectrum and its fit together", () => {
    const { y, fit } = processSpectrum(fixture.x, fixture.y, { background: "fit", window: fixture.background_window, smooth: 0, normalise: "max" });
    expect(Math.max(...y)).toBe(1);
    expect(fit![0]).toBeCloseTo(powerLaw(fixture.x, fixture.y, ...(fixture.background_window as [number, number]))![0] / Math.max(...fixture.y));
  });
});

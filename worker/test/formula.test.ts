import { describe, expect, it } from "vitest";
import { formulaTokens } from "../src/pages/layout";

const render = (f: string) =>
  formulaTokens(f)
    .map(([k, v]) => (k === "text" ? v : k === "sub" ? `_${v}` : k === "sup" ? `^${v}` : `_<${v}>`))
    .join("");

describe("formulaTokens", () => {
  it.each([
    ["TiO2", "TiO_2"],
    ["((Y_{0.2} La{0.8})S)1.16-TaS_2", "((Y_0.2 La_0.8)S)_1.16-TaS_2"],
    ["(C2H4)n", "(C_2H_4)_<n>"],
    ["(C8H8)n-(C3H3N)m", "(C_8H_8)_<n>-(C_3H_3N)_<m>"],
    ["CePrOx/Al2O3-La2O3", "CePrO_<x>/Al_2O_3-La_2O_3"],
    ["Zircaloy-4", "Zircaloy-4"],
    ["SiC(6H)", "SiC(6H)"],
    ["ZrO2-8.5mol%Y2O3", "ZrO_2-8.5mol%Y_2O_3"],
    ["Fe2O3 (alpha)", "Fe_2O_3 (α)"],
    ["alpha-Fe2O3", "α-Fe_2O_3"],
    ["MnO3", "MnO_3"],
    ["Dy2O3", "Dy_2O_3"],
    ["Fe^{3+}", "Fe^3+"],
    ["MoO(3-X)", "MoO(3-X)"],
  ])("%s", (input, expected) => {
    expect(render(input)).toBe(expected);
  });
});

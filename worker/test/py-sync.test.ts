import { expect, it } from "vitest";

const browser = import.meta.glob<string>("../public/py/eelsdb/*.py", { eager: true, query: "?raw", import: "default" });
const python = import.meta.glob<string>("../../python/eelsdb/*.py", { eager: true, query: "?raw", import: "default" });

it("serves the same eelsdb modules that the Python tests check (npm run py)", () => {
  const name = (p: string) => p.split("/").pop();
  expect(Object.keys(browser).map(name).sort()).toEqual(Object.keys(python).map(name).sort());
  for (const [p, src] of Object.entries(python)) {
    expect(browser[`../public/py/eelsdb/${name(p)}`], name(p)).toBe(src);
  }
});

import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("serves the API on api.*", async () => {
  const res = await exports.default.fetch("https://api.eelsdb.eu/");
  expect(res.headers.get("content-type")).toContain("application/json");
});

it("serves pages on other hosts", async () => {
  const res = await exports.default.fetch("https://eelsdb.eu/");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("EELS Data Base");
});

it("sends basic security headers", async () => {
  const res = await exports.default.fetch("https://eelsdb.eu/");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
});

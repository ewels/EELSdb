import { describe, expect, it } from "vitest";
import { rehost } from "../src/site";

describe("rehost", () => {
  const text = "See https://eelsdb.eu/docs/ and https://api.eelsdb.eu/v2/spectra; write to info@eelsdb.eu.";

  it("points site and API links at another deployment", () => {
    expect(rehost(text, "https://dev.example.org")).toBe(
      "See https://dev.example.org/docs/ and https://api.dev.example.org/v2/spectra; write to info@eelsdb.eu.",
    );
  });

  it("leaves production text alone", () => {
    expect(rehost(text, "https://eelsdb.eu")).toBe(text);
  });
});

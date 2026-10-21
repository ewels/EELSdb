/** Legacy WordPress excerpts hold HTML entities such as &#8217; and a trailing "[&hellip;]". */
export function decodeEntities(s: string) {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0", hellip: "…" };
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, k) => named[k.toLowerCase()] ?? m)
    .replace(/\s*\[…\]$/, "…");
}

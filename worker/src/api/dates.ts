// D1 stores times as "YYYY-MM-DD HH:MM:SS" in UTC (SQLite's datetime('now')), so they compare as strings.

/**
 * When a published spectrum last changed. Edits before publication can leave `updated_at` older than
 * `published_at`, and harvesters asking for changes since a date must still see the publication.
 */
export const MODIFIED_SQL = "MAX(s.published_at, COALESCE(s.updated_at, s.published_at))";

export const modifiedAt = (s: Record<string, any>): string | null =>
  s.updated_at && (!s.published_at || s.updated_at > s.published_at) ? s.updated_at : s.published_at;

/** "2026-01-31" or "2026-01-31T09:00:00Z" as a stored time; a bare date is the start of the day, or its end with `end`. */
export function sqlTime(v: string, end = false): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}:\d{2})Z)?$/.exec(v);
  const t = m && new Date(`${m[1]}T${m[2] ?? "00:00:00"}Z`);
  // Round-trips so that 2026-02-31 or 25:00:00 are refused rather than rolled over.
  if (!m || !t || Number.isNaN(t.getTime()) || t.toISOString().slice(0, 19) !== `${m[1]}T${m[2] ?? "00:00:00"}`) return null;
  return `${m[1]} ${m[2] ?? (end ? "23:59:59" : "00:00:00")}`;
}

/** A stored time as ISO 8601 UTC, "2026-01-31T09:00:00Z". */
export const isoTime = (v: string) => `${v.replace(" ", "T")}Z`;

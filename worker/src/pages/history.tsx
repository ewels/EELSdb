import { HAS_PAGE_SQL } from "./profile";

const FIELD_NAMES: Record<string, string> = {
  source_purity: "source and purity",
  other_urls: "other links",
  associated: "associated spectra",
  core: "measurement details",
};

export type HistoryEvent = { at: string; label: string; name: string | null; page: string | null };

/** Changes since publication, newest first, ending with the publication. Steps before it (draft, submission, review) stay private. */
export async function spectrumHistory(db: D1Database, s: Record<string, any>): Promise<HistoryEvent[]> {
  const { results } = await db.prepare(
    `SELECT h.at, h.change_json, u.display_name, CASE WHEN ${HAS_PAGE_SQL} THEN u.slug END AS page
     FROM history h LEFT JOIN users u ON u.id = h.user_id
     WHERE h.spectrum_id = ?1 AND h.id > COALESCE((SELECT MAX(id) FROM history WHERE spectrum_id = ?1 AND change_json ->> '$.action' = 'new approved'), 0)
     ORDER BY h.at DESC, h.id DESC`,
  ).bind(s.id).all<any>();
  const changes = results.map((h) => {
    const change = JSON.parse(h.change_json);
    const fields = change.changes ? Object.keys(change.changes).map((k) => FIELD_NAMES[k] ?? k).join(", ") : "";
    return { at: h.at, label: `${change.action}${fields ? ` (${fields})` : ""}`, name: h.display_name, page: h.page };
  });
  return [...changes, { at: s.published_at ?? "", label: "published", name: s.author_display, page: s.author_slug }];
}

export const HistoryTimeline = (props: { events: HistoryEvent[] }) => (
  <ol class="timeline">
    {props.events.map((e) => (
      <li>
        <span class="timeline-label">{e.label}</span>
        <span class="timeline-meta">
          <time datetime={e.at.replace(" ", "T")}>{e.at.slice(0, 16).replace("T", " ").replace(/ 00:00$/, "")}</time>
          {e.name && <> · {e.page ? <a href={`/author/${e.page}/`}>{e.name}</a> : e.name}</>}
        </span>
      </li>
    ))}
  </ol>
);

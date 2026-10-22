export type Facts = {
  id: number;
  display_name: string;
  slug: string | null;
  role: string;
  avatar_key: string | null;
  orcid: string | null;
  has_password: boolean;
  mfa_all_methods: boolean;
  emails: { id: number; email: string; verified: number; is_primary: number }[];
  identities: { provider: string; subject: string }[];
  totp: boolean;
  recovery_codes: number;
  passkeys: number;
  spectra: number;
  drafts: number;
  submissions: number;
  instruments: number;
  favourites: number;
  tokens: number;
  sessions: number;
};

export async function accountFacts(db: D1Database, id: number): Promise<Facts | null> {
  const [{ results: [u] }, { results: emails }, { results: identities }] = await db.batch<any>([
    db.prepare(
      `SELECT u.id, u.display_name, u.slug, u.role, u.avatar_key, u.orcid, u.mfa_all_methods,
              (u.password_hash IS NOT NULL OR u.legacy_password_hash IS NOT NULL) AS has_password,
              EXISTS (SELECT 1 FROM user_totp t WHERE t.user_id = u.id AND t.enabled_at IS NOT NULL) AS totp,
              (SELECT COUNT(*) FROM recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS recovery_codes,
              (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys,
              (SELECT COUNT(*) FROM spectra s WHERE s.owner_id = u.id AND s.status != 'draft') AS spectra,
              (SELECT COUNT(*) FROM spectra s WHERE s.owner_id = u.id AND s.status = 'draft') AS drafts,
              (SELECT COUNT(*) FROM submissions b WHERE b.submitted_by = u.id) AS submissions,
              (SELECT COUNT(*) FROM instruments i WHERE i.created_by = u.id) AS instruments,
              (SELECT COUNT(*) FROM favourites f WHERE f.user_id = u.id) AS favourites,
              (SELECT COUNT(*) FROM draft_tokens d WHERE d.user_id = u.id) AS tokens,
              (SELECT COUNT(*) FROM sessions x WHERE x.user_id = u.id AND x.expires_at > ?) AS sessions
       FROM users u WHERE u.id = ?`,
    ).bind(new Date().toISOString(), id),
    db.prepare("SELECT id, email, verified, is_primary FROM user_emails WHERE user_id = ? ORDER BY is_primary DESC, verified DESC, email").bind(id),
    db.prepare("SELECT provider, subject FROM identities WHERE user_id = ? ORDER BY provider, subject").bind(id),
  ]);
  if (!u) return null;
  return { ...u, has_password: !!u.has_password, mfa_all_methods: !!u.mfa_all_methods, totp: !!u.totp, emails, identities };
}

const ROLE_RANK: Record<string, number> = { user: 0, moderator: 1, admin: 2 };
export const outranks = (a: string, b: string) => (ROLE_RANK[a] ?? 0) > (ROLE_RANK[b] ?? 0);

/** What `mergeAccounts` will do with the parts that depend on both accounts; the confirmation page lists the same lines. */
export function mergePlan(kept: Facts, gone: Facts) {
  const keptEmails = new Set(kept.emails.map((e) => e.email.toLowerCase()));
  const keptProviders = new Set(kept.identities.map((i) => i.provider));
  const moves: string[] = [];
  const drops: string[] = [];
  const dupes = gone.emails.filter((e) => keptEmails.has(e.email.toLowerCase()));
  const emails = gone.emails.length - dupes.length;
  if (emails) moves.push(`${emails} email ${emails === 1 ? "address" : "addresses"} (the kept account's primary stays primary)`);
  if (dupes.length) drops.push(`${dupes.length} email ${dupes.length === 1 ? "address" : "addresses"} the kept account already has`);
  const identities = gone.identities.filter((i) => !keptProviders.has(i.provider));
  const doubled = gone.identities.filter((i) => keptProviders.has(i.provider));
  if (identities.length) moves.push(`Linked accounts: ${identities.map((i) => i.provider).join(", ")}`);
  if (doubled.length) drops.push(`Linked accounts of a service the kept account already has: ${doubled.map((i) => i.provider).join(", ")}`);
  if (gone.has_password) (kept.has_password ? drops : moves).push(kept.has_password ? "Password (the kept account has one)" : "Password");
  if (gone.totp) (kept.totp ? drops : moves).push(kept.totp ? "Authenticator app and recovery codes (the kept account has its own)" : "Authenticator app and recovery codes");
  if (gone.passkeys) moves.push(`${gone.passkeys} ${gone.passkeys === 1 ? "passkey" : "passkeys"}`);
  if (gone.mfa_all_methods && !kept.mfa_all_methods) moves.push("The setting to ask for a second step after ORCID, Google and GitHub");
  if (gone.avatar_key) (kept.avatar_key ? drops : moves).push(kept.avatar_key ? "Uploaded picture (the kept account has one)" : "Uploaded picture");
  if (gone.orcid && !kept.orcid) moves.push("ORCID iD");
  if (gone.slug && !kept.slug) moves.push(`Username ${gone.slug}`);
  else if (gone.slug) moves.push(`The old author address /author/${gone.slug}/ (it redirects to the kept account's)`);
  drops.push("Name, affiliation, country, job title, links, theme and profile settings", `Their ${gone.sessions} active ${gone.sessions === 1 ? "session" : "sessions"} (they are signed out)`);
  return { moves, drops, dupes };
}

/**
 * Merges `fromId` into `intoId` in one batch and deletes `fromId`. The kept account's name, profile, role and username win.
 * Returns the avatar R2 key that is no longer used, for the caller to delete.
 */
export async function mergeAccounts(db: D1Database, fromId: number, intoId: number): Promise<{ droppedAvatar: string | null }> {
  const [gone, kept] = await Promise.all([accountFacts(db, fromId), accountFacts(db, intoId)]);
  if (!gone || !kept || fromId === intoId) throw new Error("Cannot merge these accounts");
  const [from, to] = [fromId, intoId];
  const plan = mergePlan(kept, gone);
  const move = (table: string, column: string) => db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).bind(to, from);
  const statements: D1PreparedStatement[] = [
    // Sign-in links are by address and addresses are about to move.
    db.prepare("DELETE FROM login_links WHERE email IN (SELECT email FROM user_emails WHERE user_id = ?)").bind(from),
    db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(from),
    db.prepare("DELETE FROM login_challenges WHERE user_id = ?").bind(from),
    db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").bind(from),
    db.prepare("DELETE FROM account_claims WHERE user_id = ? OR legacy_user_id IN (?, ?)").bind(from, from, to),
  ];

  // An address both accounts have stays once. A verified address is unique, so the merged-away row goes first and then confirms the kept one.
  const keptByEmail = new Map(kept.emails.map((e) => [e.email.toLowerCase(), e]));
  for (const e of plan.dupes) {
    statements.push(db.prepare("DELETE FROM user_emails WHERE id = ?").bind(e.id));
    const same = keptByEmail.get(e.email.toLowerCase())!;
    if (e.verified && !same.verified) statements.push(db.prepare("UPDATE user_emails SET verified = 1 WHERE id = ?").bind(same.id));
  }
  statements.push(
    db.prepare("UPDATE user_emails SET user_id = ?, is_primary = 0 WHERE user_id = ?").bind(to, from),
    db.prepare(
      `UPDATE user_emails SET is_primary = 1 WHERE id = (SELECT id FROM user_emails WHERE user_id = ?1 ORDER BY verified DESC, id LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM user_emails WHERE user_id = ?1 AND is_primary = 1)`,
    ).bind(to),
    // The app allows one linked account per service; the kept account's wins. A verified ORCID sign-in beats a typed iD.
    db.prepare("DELETE FROM identities WHERE user_id = ? AND provider IN (SELECT provider FROM identities WHERE user_id = ?)").bind(from, to),
    move("identities", "user_id"),
    db.prepare("UPDATE users SET orcid = (SELECT subject FROM identities WHERE user_id = ?1 AND provider = 'orcid') WHERE id = ?1 AND EXISTS (SELECT 1 FROM identities WHERE user_id = ?1 AND provider = 'orcid')").bind(to),
  );

  // Two-step: each kind moves only if the kept account has none, so the kept account's protection is never replaced.
  // An authenticator set-up the kept account never confirmed counts as none.
  if (gone.totp && !kept.totp) {
    statements.push(
      db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(to),
      db.prepare("DELETE FROM user_totp WHERE user_id = ?").bind(to),
      move("user_totp", "user_id"),
      move("recovery_codes", "user_id"),
    );
  } else {
    statements.push(db.prepare("DELETE FROM recovery_codes WHERE user_id = ?").bind(from), db.prepare("DELETE FROM user_totp WHERE user_id = ?").bind(from));
  }
  // Passkeys live on the person's devices and never conflict, so all of them carry over (unlike the one authenticator secret).
  statements.push(move("passkeys", "user_id"));
  statements.push(
    db.prepare(
      `UPDATE users SET avatar_key = COALESCE(avatar_key, (SELECT avatar_key FROM users WHERE id = ?1)),
         orcid = COALESCE(orcid, (SELECT orcid FROM users WHERE id = ?1)),
         mfa_all_methods = MAX(mfa_all_methods, (SELECT mfa_all_methods FROM users WHERE id = ?1))
       WHERE id = ?2`,
    ).bind(from, to),
    move("draft_tokens", "user_id"),
  );
  // Both hash columns travel together, so a password never ends up half there.
  if (!kept.has_password) {
    statements.push(
      db.prepare("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE id = ?1), legacy_password_hash = (SELECT legacy_password_hash FROM users WHERE id = ?1) WHERE id = ?2").bind(from, to),
    );
  }

  // Usernames are unique, so the merged-away one is freed first. If the kept account has none it takes it; otherwise the old
  // author address redirects through user_slug_history.
  statements.push(
    db.prepare("UPDATE users SET slug = NULL WHERE id = ?").bind(from),
    db.prepare("UPDATE users SET slug = COALESCE(slug, ?) WHERE id = ?").bind(gone.slug, to),
    move("user_slug_history", "user_id"),
    db.prepare("INSERT OR REPLACE INTO user_slug_history (slug, user_id) SELECT ?1, ?2 WHERE ?1 IS NOT NULL AND ?1 != COALESCE((SELECT slug FROM users WHERE id = ?2), '')").bind(gone.slug, to),
    db.prepare("UPDATE spectra SET author_slug = (SELECT slug FROM users WHERE id = ?1), author_display = (SELECT display_name FROM users WHERE id = ?1), updated_at = datetime('now') WHERE owner_id = ?2").bind(to, from),
    move("spectra", "owner_id"),
    db.prepare("INSERT OR IGNORE INTO favourites (user_id, spectrum_id, created_at) SELECT ?, spectrum_id, created_at FROM favourites WHERE user_id = ?").bind(to, from),
    db.prepare("DELETE FROM favourites WHERE user_id = ?").bind(from),
    move("submissions", "submitted_by"),
    move("submissions", "decided_by"),
    move("history", "user_id"),
    move("instruments", "created_by"),
    move("instrument_versions", "created_by"),
    move("instrument_versions", "decided_by"),
    move("admin_actions", "admin_id"),
    move("admin_actions", "user_id"),
    move("site_settings", "updated_by"),
    move("site_settings_log", "changed_by"),
    move("contact_messages", "user_id"),
    db.prepare("DELETE FROM users WHERE id = ?").bind(from),
  );
  await db.batch(statements);
  return { droppedAvatar: gone.avatar_key && kept.avatar_key ? gone.avatar_key : null };
}

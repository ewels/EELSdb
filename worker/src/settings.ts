/** Sign-in methods an admin can switch off, in the order the sign-in page shows them. */
export const SIGN_IN_METHODS = ["orcid", "google", "github", "passkey", "email_link", "password"] as const;
export type SwitchableMethod = (typeof SIGN_IN_METHODS)[number];

const DEFAULTS = {
  require_orcid: "1",
  signin_orcid: "1",
  signin_google: "1",
  signin_github: "1",
  signin_passkey: "1",
  signin_email_link: "1",
  signin_password: "1",
  require_2fa_admin: "1",
  require_2fa_moderator: "1",
  require_2fa_user: "0",
} as const;
export type SettingKey = keyof typeof DEFAULTS;
export type Settings = Record<SettingKey, string>;

/** Every setting, with the default for a key that has no row. */
export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM site_settings").all<{ key: string; value: string }>();
  const settings: Settings = { ...DEFAULTS };
  for (const r of results) if (r.key in DEFAULTS) settings[r.key as SettingKey] = r.value;
  return settings;
}

export const setSetting = (db: D1Database, key: SettingKey, value: string, userId: number) =>
  db.prepare(
    `INSERT INTO site_settings (key, value, updated_by) VALUES (?1, ?2, ?3)
     ON CONFLICT (key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = datetime('now')`,
  ).bind(key, value, userId).run();

/** Groups that can be made to use two-step sign-in, keyed by role and by the setting that decides it. */
export const TWO_STEP_GROUPS = [
  { role: "admin", key: "require_2fa_admin" },
  { role: "moderator", key: "require_2fa_moderator" },
  { role: "user", key: "require_2fa_user" },
] as const;

/** Whether the group this role belongs to must use two-step sign-in. */
export const twoStepRequired = (s: Settings, role: string) => {
  const g = TWO_STEP_GROUPS.find((x) => x.role === role);
  return !!g && s[g.key] === "1";
};

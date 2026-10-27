/** Small key/value store for deployment settings changed from the UI (e.g. the interviewer voice). */
import { getDb } from "./db";

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) {
    getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
    return;
  }
  getDb()
    .prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, value, new Date().toISOString());
}

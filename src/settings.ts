import { getMeta, setMeta } from './db/meta';
import type { AppSettings, ThemePreference } from './db/types';
import { DEFAULT_SETTINGS } from './db/types';

const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<AppSettings> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setMeta(SETTINGS_KEY, settings);
}

export type { AppSettings, ThemePreference };
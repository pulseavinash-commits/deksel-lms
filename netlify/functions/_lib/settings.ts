import { db } from './db';

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from('app_settings').select('value').eq('key', key).maybeSingle();
  return data ? (data.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const { error } = await db()
    .from('app_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export interface GeminiConfig {
  live_model: string;
  voice: string;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  store_raw_audio: boolean;
  data_retention_days: number;
}

export const DEFAULT_GEMINI: GeminiConfig = {
  live_model: 'gemini-2.5-flash-native-audio-preview-09-2025',
  voice: 'Kore',
  last_test_at: null,
  last_test_ok: null,
  store_raw_audio: false,
  data_retention_days: 365,
};

export async function getGeminiConfig(): Promise<GeminiConfig> {
  return getSetting<GeminiConfig>('gemini', DEFAULT_GEMINI);
}

export function maskKey(key: string | undefined): string {
  if (!key) return 'not configured';
  if (key.length < 10) return '••••';
  return `${key.slice(0, 4)}${'•'.repeat(8)}${key.slice(-3)}`;
}

import type { Config } from '@netlify/functions';
import { json, err, csrfCheck, readJson } from './_lib/http';
import { requireAdmin } from './_lib/auth';
import { audit } from './_lib/audit';
import { getGeminiConfig, setSetting, maskKey } from './_lib/settings';
import { serverAI } from './_lib/gemini';
import { LIVE_MODELS, TRAINER_VOICES } from '../../shared/types';

export const config: Config = {
  path: ['/api/admin/gemini', '/api/admin/gemini/test'],
};

/**
 * GET  /api/admin/gemini       — status (masked key, model, voice, last test)
 * PUT  /api/admin/gemini       — update model/voice/audio-retention settings
 * POST /api/admin/gemini/test  — test connection with the server-side key
 *
 * The permanent key itself lives ONLY in the GEMINI_API_KEY environment
 * variable. "Replace key" is done by rotating that env var in Netlify —
 * the key is never accepted from, or returned to, the browser.
 */
export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const admin = await requireAdmin(req);
  if (!admin) return err('Not authenticated', 401);
  const path = new URL(req.url).pathname;

  if (path === '/api/admin/gemini' && req.method === 'GET') {
    const cfg = await getGeminiConfig();
    return json({
      configured: !!process.env.GEMINI_API_KEY,
      masked_key: maskKey(process.env.GEMINI_API_KEY),
      live_model: cfg.live_model,
      voice: cfg.voice,
      last_test_at: cfg.last_test_at,
      last_test_ok: cfg.last_test_ok,
      store_raw_audio: cfg.store_raw_audio,
      data_retention_days: cfg.data_retention_days,
      available_models: LIVE_MODELS,
      available_voices: TRAINER_VOICES,
      replace_key_hint: 'Rotate the GEMINI_API_KEY environment variable in Netlify → Site configuration → Environment variables, then redeploy.',
    });
  }

  if (path === '/api/admin/gemini' && req.method === 'PUT') {
    const body = await readJson<Record<string, unknown>>(req);
    if (!body) return err('Invalid body');
    const cfg = await getGeminiConfig();
    if (typeof body.live_model === 'string' && (LIVE_MODELS as readonly string[]).includes(body.live_model)) {
      cfg.live_model = body.live_model;
    }
    if (typeof body.voice === 'string' && (TRAINER_VOICES as readonly string[]).includes(body.voice)) {
      cfg.voice = body.voice;
    }
    if (typeof body.store_raw_audio === 'boolean') cfg.store_raw_audio = body.store_raw_audio;
    const days = Number(body.data_retention_days);
    if (Number.isFinite(days) && days >= 30 && days <= 3650) cfg.data_retention_days = Math.round(days);
    await setSetting('gemini', cfg);
    await audit(admin.sub, 'gemini.settings', { live_model: cfg.live_model, voice: cfg.voice, store_raw_audio: cfg.store_raw_audio });
    return json({ ok: true });
  }

  if (path === '/api/admin/gemini/test' && req.method === 'POST') {
    if (!process.env.GEMINI_API_KEY) return err('GEMINI_API_KEY is not configured on the server', 400);
    const cfg = await getGeminiConfig();
    try {
      const ai = serverAI();
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'Reply with exactly: OK',
      });
      const ok = (res.text ?? '').toUpperCase().includes('OK');
      cfg.last_test_at = new Date().toISOString();
      cfg.last_test_ok = ok;
      await setSetting('gemini', cfg);
      await audit(admin.sub, 'gemini.test', { ok });
      return json({ ok, tested_at: cfg.last_test_at });
    } catch (e) {
      cfg.last_test_at = new Date().toISOString();
      cfg.last_test_ok = false;
      await setSetting('gemini', cfg);
      return json({ ok: false, error: e instanceof Error ? e.message : 'Test failed', tested_at: cfg.last_test_at });
    }
  }

  return err('Not found', 404);
}

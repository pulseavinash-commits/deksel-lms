import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

interface GeminiInfo {
  configured: boolean;
  masked_key: string;
  live_model: string;
  voice: string;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  store_raw_audio: boolean;
  data_retention_days: number;
  available_models: string[];
  available_voices: string[];
  replace_key_hint: string;
}

export default function GeminiSettings() {
  const [info, setInfo] = useState<GeminiInfo | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<GeminiInfo>('/api/admin/gemini').then(setInfo)
    .catch((e) => setBanner({ kind: 'err', text: e.message }));
  useEffect(() => { load(); }, []);

  if (!info) return <p><span className="spinner" /> Loading…</p>;

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/admin/gemini', { method: 'PUT', body: info });
      setBanner({ kind: 'ok', text: 'Gemini settings saved' });
    } catch (e) { setBanner({ kind: 'err', text: e instanceof ApiError ? e.message : 'Save failed' }); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setBanner(null);
    try {
      const r = await api<{ ok: boolean; error?: string }>('/api/admin/gemini/test', { method: 'POST', body: {} });
      setBanner(r.ok ? { kind: 'ok', text: 'Connection test passed ✓' } : { kind: 'err', text: `Test failed: ${r.error ?? 'unknown'}` });
      await load();
    } catch (e) { setBanner({ kind: 'err', text: e instanceof ApiError ? e.message : 'Test failed' }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <h2>Gemini Live configuration</h2>
      {banner && <div className={banner.kind === 'ok' ? 'success-banner' : 'error-banner'}>{banner.text}</div>}
      <div className="admin-card">
        <p>
          <strong>Status:</strong>{' '}
          {info.configured
            ? <span className="badge badge-ok">Gemini configured</span>
            : <span className="badge badge-bad">Not configured</span>}
        </p>
        <p><strong>API key:</strong> <code>{info.masked_key}</code></p>
        <p style={{ fontSize: '.85rem', color: 'var(--admin-dim)' }}>
          <strong>Replace key:</strong> {info.replace_key_hint} The permanent key is held only on the server and is never sent to any browser.
        </p>
        <p>
          <strong>Last successful test:</strong>{' '}
          {info.last_test_at
            ? `${new Date(info.last_test_at).toLocaleString()} — ${info.last_test_ok ? 'passed ✓' : 'FAILED ✗'}`
            : 'never tested'}
        </p>
        <button className="btn btn-primary" onClick={test} disabled={busy || !info.configured}>
          {busy ? <span className="spinner" /> : 'Test connection'}
        </button>
      </div>

      <div className="admin-card">
        <div className="field"><label>Live model</label>
          <select value={info.live_model} onChange={(e) => setInfo({ ...info, live_model: e.target.value })}>
            {info.available_models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
        <div className="field"><label>Trainer voice</label>
          <select value={info.voice} onChange={(e) => setInfo({ ...info, voice: e.target.value })}>
            {info.available_voices.map((v) => <option key={v} value={v}>{v}</option>)}
          </select></div>
        <div className="field"><label>Store raw learner audio (must remain disclosed in the consent screen)</label>
          <select value={info.store_raw_audio ? '1' : '0'} onChange={(e) => setInfo({ ...info, store_raw_audio: e.target.value === '1' })}>
            <option value="0">No — transcripts only (recommended)</option>
            <option value="1">Yes — explicitly enabled</option>
          </select></div>
        <div className="field"><label>Data retention period (days, shown to learners)</label>
          <input type="number" min={30} max={3650} value={info.data_retention_days}
            onChange={(e) => setInfo({ ...info, data_retention_days: Number(e.target.value) })} /></div>
        <button className="btn btn-primary" onClick={save} disabled={busy}>Save settings</button>
      </div>
    </div>
  );
}

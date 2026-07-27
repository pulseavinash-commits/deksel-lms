import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';

export default function AdminSettings() {
  const [isSet, setIsSet] = useState<boolean | null>(null);
  const [pw, setPw] = useState('');
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ set: boolean }>('/api/admin/learner-password').then((r) => setIsSet(r.set)).catch(() => setIsSet(null));
  }, []);

  const save = async () => {
    setBusy(true); setBanner(null);
    try {
      await api('/api/admin/learner-password', { method: 'PUT', body: { password: pw } });
      setBanner({ kind: 'ok', text: 'Learner access password updated (stored as a secure hash only)' });
      setPw(''); setIsSet(true);
    } catch (e) { setBanner({ kind: 'err', text: e instanceof ApiError ? e.message : 'Update failed' }); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 620 }}>
      <h2>Settings</h2>
      {banner && <div className={banner.kind === 'ok' ? 'success-banner' : 'error-banner'}>{banner.text}</div>}
      <div className="admin-card">
        <h3>Learner access password</h3>
        <p style={{ color: 'var(--admin-dim)', fontSize: '.9rem' }}>
          Learners must enter this password before registration. Only a bcrypt hash is stored; the
          password is verified exclusively on the server. Status:{' '}
          {isSet == null ? '…' : isSet ? <span className="badge badge-ok">Set</span> : <span className="badge badge-warn">Not set</span>}
        </p>
        <div className="field"><label>New learner access password (6–100 chars)</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={save} disabled={busy || pw.length < 6}>Rotate password</button>
      </div>
    </div>
  );
}

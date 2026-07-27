import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export default function AccessGate({ onVerified }: { onVerified: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/learn/access', { method: 'POST', body: { password: pw } });
      onVerified();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="learn-root">
      <div className="learn-gate-wrap">
        <div className="learn-card">
          <h2 style={{ color: 'var(--learn-accent)' }}>🎓 Learner Portal</h2>
          <p style={{ color: 'var(--learn-dim)' }}>
            Enter the access password provided by your training team to begin.
          </p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>Access password</label>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
            </div>
            <button className="btn btn-primary" disabled={busy || !pw} style={{ width: '100%' }}>
              {busy ? <span className="spinner" /> : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

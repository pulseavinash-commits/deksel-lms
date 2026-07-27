import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export default function AdminLogin({ onLogin }: { onLogin: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      // Bootstrap the first admin from env vars if none exists yet (no-op otherwise).
      await api('/api/admin/bootstrap', { method: 'POST', body: {} }).catch(() => undefined);
      const r = await api<{ email: string }>('/api/admin/login', { method: 'POST', body: { email, password } });
      onLogin(r.email);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-root">
      <div className="admin-login-wrap">
        <div className="admin-card">
          <h2>Admin Portal</h2>
          <p style={{ color: 'var(--admin-dim)', fontSize: '.9rem' }}>
            Server-verified sign in. Sessions use secure HTTP-only cookies.
          </p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={submit}>
            <div className="field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
              {busy ? <span className="spinner" /> : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

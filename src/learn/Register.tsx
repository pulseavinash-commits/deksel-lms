import { useState } from 'react';
import { api, ApiError } from '../lib/api';

export default function Register({ onRegistered }: { onRegistered: (name: string) => void }) {
  const [form, setForm] = useState({ name: '', designation: '', headquarter: '', employee_code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/learn/register', { method: 'POST', body: form });
      onRegistered(form.name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="learn-root">
      <div className="learn-gate-wrap">
        <div className="learn-card">
          <h2 style={{ color: 'var(--learn-accent)' }}>Your details</h2>
          <p style={{ color: 'var(--learn-dim)', fontSize: '.9rem' }}>Learning language: English</p>
          {error && <div className="error-banner">{error}</div>}
          <form onSubmit={submit}>
            <div className="field"><label>Full name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} /></div>
            <div className="field"><label>Designation *</label>
              <input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} required maxLength={120} /></div>
            <div className="field"><label>Headquarter *</label>
              <input value={form.headquarter} onChange={(e) => setForm({ ...form, headquarter: e.target.value })} required maxLength={120} /></div>
            <div className="field"><label>Employee code (optional)</label>
              <input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} maxLength={60} /></div>
            <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
              {busy ? <span className="spinner" /> : 'Start learning'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

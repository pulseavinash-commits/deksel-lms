import { useState } from 'react';
import { api, ApiError } from '../lib/api';

function Stars({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= value ? 'on' : ''} onClick={() => onChange(n)} aria-label={`${n} stars`}>★</button>
      ))}
    </span>
  );
}

export default function RatingModal({ onDone }: { onDone: () => void }) {
  const [overall, setOverall] = useState(0);
  const [clarity, setClarity] = useState(0);
  const [usefulness, setUsefulness] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await api('/api/learn/rating', { method: 'POST', body: { overall, clarity, usefulness, feedback } });
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not submit rating');
    } finally { setBusy(false); }
  };

  if (submitted) {
    return (
      <div className="modal-overlay">
        <div className="modal" style={{ maxWidth: 440, textAlign: 'center' }}>
          <h3>🎉 Module completed!</h3>
          <p>Thank you — your training record has been saved.</p>
          <button className="btn btn-primary" onClick={onDone}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480 }}>
        <h3>Rate this module</h3>
        <p style={{ color: 'var(--learn-dim)', fontSize: '.9rem' }}>
          Required to complete the module.
        </p>
        {error && <div className="error-banner">{error}</div>}
        <div className="field"><label>Overall rating *</label><Stars value={overall} onChange={setOverall} /></div>
        <div className="field"><label>AI trainer clarity *</label><Stars value={clarity} onChange={setClarity} /></div>
        <div className="field"><label>Module usefulness *</label><Stars value={usefulness} onChange={setUsefulness} /></div>
        <div className="field"><label>Written feedback (optional)</label>
          <textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={4000} /></div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !overall || !clarity || !usefulness}
          onClick={submit}>
          {busy ? <span className="spinner" /> : 'Submit & complete module'}
        </button>
      </div>
    </div>
  );
}

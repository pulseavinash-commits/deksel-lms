import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ReportRow } from '../../shared/types';

interface SessionDetail {
  attempts: Array<{
    slide_id: string; question_position: number; attempt_number: number; is_corrective: boolean;
    question: string; answer_transcript: string; score: number | null; passed: boolean | null;
    feedback: string | null; created_at: string;
  }>;
  transcripts: Array<{ role: string; kind: string; text: string; created_at: string }>;
  progress: Array<{ slide_id: string; state: string; best_score: number | null }>;
}

const EMPTY = { from: '', to: '', headquarter: '', designation: '', version: '', status: '', min_score: '', max_score: '' };

export default function Reports() {
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [filters, setFilters] = useState({ ...EMPTY });
  const [detail, setDetail] = useState<{ row: ReportRow; data: SessionDetail } | null>(null);
  const [error, setError] = useState('');

  const qs = () => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && p.set(k, v));
    return p.toString() ? `?${p.toString()}` : '';
  };

  const load = () => {
    setRows(null); setError('');
    api<{ rows: ReportRow[] }>(`/api/admin/reports${qs()}`)
      .then((r) => setRows(r.rows))
      .catch((e) => { setError(String(e.message ?? e)); setRows([]); });
  };
  useEffect(load, []); // eslint-disable-line

  const openDetail = async (row: ReportRow) => {
    const data = await api<SessionDetail>(`/api/admin/reports/session/${row.session_id}`);
    setDetail({ row, data });
  };

  const fmtMin = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`;

  return (
    <div>
      <h2>Learner reports</h2>
      {error && <div className="error-banner">{error}</div>}
      <div className="admin-card">
        <div className="report-filters">
          <div className="field"><label>From date</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></div>
          <div className="field"><label>To date</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></div>
          <div className="field"><label>Headquarter</label>
            <input value={filters.headquarter} onChange={(e) => setFilters({ ...filters, headquarter: e.target.value })} /></div>
          <div className="field"><label>Designation</label>
            <input value={filters.designation} onChange={(e) => setFilters({ ...filters, designation: e.target.value })} /></div>
          <div className="field"><label>Course version</label>
            <input type="number" value={filters.version} onChange={(e) => setFilters({ ...filters, version: e.target.value })} /></div>
          <div className="field"><label>Status</label>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any</option>
              <option value="registered">Registered</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select></div>
          <div className="field"><label>Min score</label>
            <input type="number" min={0} max={100} value={filters.min_score} onChange={(e) => setFilters({ ...filters, min_score: e.target.value })} /></div>
          <div className="field"><label>Max score</label>
            <input type="number" min={0} max={100} value={filters.max_score} onChange={(e) => setFilters({ ...filters, max_score: e.target.value })} /></div>
          <button className="btn btn-primary btn-sm" onClick={load}>Apply</button>
          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--admin-dim)' }}
            onClick={() => { setFilters({ ...EMPTY }); setTimeout(load, 0); }}>Clear</button>
          <a className="btn btn-outline btn-sm" style={{ color: 'var(--admin-accent-2)' }}
            href={`/api/admin/reports/export${qs()}`}>⬇ Export CSV (Excel)</a>
        </div>

        {rows === null && <p><span className="spinner" /> Loading…</p>}
        {rows && rows.length === 0 && <p style={{ color: 'var(--admin-dim)' }}>No sessions match these filters.</p>}
        {rows && rows.length > 0 && (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr>
                <th>Learner</th><th>Designation</th><th>HQ</th><th>Emp code</th><th>Course</th><th>Ver</th>
                <th>Started</th><th>Completed</th><th>Elapsed</th><th>Active</th><th>Status</th>
                <th>Slides</th><th>Score</th><th>Rating</th><th>Last activity</th><th></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.session_id}>
                    <td>{r.learner_name}</td><td>{r.designation}</td><td>{r.headquarter}</td>
                    <td>{r.employee_code ?? '—'}</td><td>{r.course_title}</td><td>v{r.course_version}</td>
                    <td>{new Date(r.started_at).toLocaleString()}</td>
                    <td>{r.completed_at ? new Date(r.completed_at).toLocaleString() : '—'}</td>
                    <td>{fmtMin(r.total_elapsed_seconds)}</td><td>{fmtMin(r.active_seconds)}</td>
                    <td><span className={`badge ${r.status === 'completed' ? 'badge-ok' : 'badge-info'}`}>{r.status}</span></td>
                    <td>{r.slides_completed}/{r.slides_total}</td>
                    <td>{r.overall_score ?? '—'}</td>
                    <td>{r.rating_overall ? `${r.rating_overall}★` : '—'}</td>
                    <td>{new Date(r.last_activity_at).toLocaleString()}</td>
                    <td><button className="btn btn-outline btn-sm" style={{ color: 'var(--admin-accent-2)' }}
                      onClick={() => openDetail(r)}>Detail</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h3>{detail.row.learner_name} — slide-wise detail</h3>
              <button className="btn btn-ghost" onClick={() => setDetail(null)}>✕</button>
            </div>
            <h4>Slide scores</h4>
            <table className="report-table" style={{ color: '#1a2b3c' }}>
              <thead><tr><th>Slide</th><th>State</th><th>Best score</th></tr></thead>
              <tbody>
                {detail.data.progress.map((p, i) => (
                  <tr key={i}><td style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>{p.slide_id.slice(0, 8)}</td>
                    <td>{p.state}</td><td>{p.best_score ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
            <h4 style={{ marginTop: '1rem' }}>Questions, answers & corrective attempts</h4>
            {detail.data.attempts.map((a, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '.6rem .8rem', marginBottom: '.5rem', color: '#1a2b3c' }}>
                <div style={{ fontSize: '.8rem', color: '#64748b' }}>
                  Q{a.question_position} · attempt {a.attempt_number}
                  {a.is_corrective && <span className="badge badge-warn" style={{ marginLeft: 6 }}>corrective</span>}
                  {' · '}{a.passed ? <span className="badge badge-ok">passed {a.score}</span> : <span className="badge badge-bad">failed {a.score}</span>}
                </div>
                <div><strong>Q:</strong> {a.question}</div>
                <div><strong>Answer:</strong> {a.answer_transcript}</div>
                {a.feedback && <div style={{ color: '#64748b' }}><strong>Feedback:</strong> {a.feedback}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

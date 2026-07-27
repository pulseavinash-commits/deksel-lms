import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { KnowledgePackage, KnowledgeSection } from '../../shared/types';

export default function KnowledgeReview({ slideId, slideTitle, onClose }: {
  slideId: string; slideTitle: string; onClose: () => void;
}) {
  const [pkg, setPkg] = useState<KnowledgePackage | null>(null);
  const [sections, setSections] = useState<KnowledgeSection[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ package: KnowledgePackage }>(`/api/admin/knowledge/${slideId}`)
      .then((r) => { setPkg(r.package); setSections(r.package.sections); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'));
  }, [slideId]);

  const save = async (approve: boolean) => {
    setBusy(true); setError('');
    try {
      await api(`/api/admin/knowledge/${slideId}`, { method: 'PUT', body: { sections, approve } });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Save failed');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3>Knowledge package — {slideTitle}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!pkg && !error && <p><span className="spinner" /> Loading…</p>}
        {pkg && (
          <>
            <p style={{ fontSize: '.85rem', color: '#64748b' }}>
              Source: {pkg.source_filename} · extracted {new Date(pkg.extracted_at).toLocaleString()}
              {pkg.edited_by_admin && ' · edited by admin'}
            </p>
            {sections.map((sec, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '.8rem', marginBottom: '.7rem' }}>
                <div className="field"><label>Section {i + 1} heading</label>
                  <input value={sec.heading}
                    onChange={(e) => setSections(sections.map((x, j) => j === i ? { ...x, heading: e.target.value } : x))} /></div>
                <div className="field"><label>Content (only this text is available to the AI trainer)</label>
                  <textarea rows={6} value={sec.content}
                    onChange={(e) => setSections(sections.map((x, j) => j === i ? { ...x, content: e.target.value } : x))} /></div>
                <button className="btn btn-danger btn-sm" onClick={() => setSections(sections.filter((_, j) => j !== i))}>
                  Remove section
                </button>
              </div>
            ))}
            <button className="btn btn-outline btn-sm" style={{ color: '#4f46e5', marginBottom: '1rem' }}
              onClick={() => setSections([...sections, { heading: `Section ${sections.length + 1}`, content: '' }])}>
              + Add section
            </button>
            <div style={{ display: 'flex', gap: '.6rem' }}>
              <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Save & approve (Ready)</button>
              <button className="btn btn-outline" style={{ color: '#4f46e5' }} onClick={() => save(false)} disabled={busy}>Save only</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

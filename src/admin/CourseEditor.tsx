import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import KnowledgeReview from './KnowledgeReview';
import type { AssessmentMode, KnowledgeStatus, SlideQuestion } from '../../shared/types';
import { MAX_SLIDES, IMAGE_MIMES, DOC_MIMES, MAX_IMAGE_BYTES, MAX_DOC_BYTES } from '../../shared/types';

interface AdminSlide {
  id: string;
  slide_number: number;
  title: string;
  learning_objective: string;
  key_message: string;
  teaching_points: string;
  restricted_statements: string;
  assessment_mode: AssessmentMode;
  passing_score: number;
  max_attempts: number;
  active: boolean;
  display_order: number;
  asset_key: string | null;
  knowledge_status: KnowledgeStatus;
  knowledge_error: string | null;
  knowledge_filename: string | null;
  questions: Array<SlideQuestion & { id?: string; slide_id?: string }>;
}

interface AdminCourse {
  id: string;
  title: string;
  description: string;
  status: string;
  current_version: number;
  expected_duration_minutes: number;
  inactivity_warning_seconds: number;
  inactivity_stop_seconds: number;
}

const STATUS_BADGE: Record<KnowledgeStatus, { label: string; cls: string }> = {
  not_uploaded: { label: 'Not uploaded', cls: 'badge-dim' },
  processing: { label: 'Processing', cls: 'badge-info' },
  ready: { label: 'Ready', cls: 'badge-ok' },
  failed: { label: 'Processing failed', cls: 'badge-bad' },
  needs_review: { label: 'Needs review', cls: 'badge-warn' },
  published: { label: 'Published', cls: 'badge-ok' },
};

const QTYPES: Array<SlideQuestion['question_type']> = ['recall', 'understanding', 'application'];

export default function CourseEditor() {
  const [course, setCourse] = useState<AdminCourse | null>(null);
  const [slides, setSlides] = useState<AdminSlide[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewSlide, setReviewSlide] = useState<AdminSlide | null>(null);
  const [previewSlide, setPreviewSlide] = useState<AdminSlide | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ course: AdminCourse; slides: AdminSlide[] }>('/api/admin/course');
    setCourse(r.course);
    setSlides(r.slides.map((s) => ({
      ...s,
      questions: [1, 2, 3].map((pos) =>
        s.questions.find((q) => q.position === pos) ??
        { position: pos as 1 | 2 | 3, question_type: QTYPES[pos - 1], question: '', expected_answer: '', keywords: [] }),
    })));
  }, []);

  useEffect(() => { load().catch((e) => setBanner({ kind: 'err', text: String(e.message ?? e) })); }, [load]);

  const flash = (kind: 'ok' | 'err', text: string) => {
    setBanner({ kind, text });
    setTimeout(() => setBanner(null), 5000);
  };

  const patchSlide = (id: string, patch: Partial<AdminSlide>) =>
    setSlides((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const saveCourseSettings = async () => {
    if (!course) return;
    setBusy(true);
    try {
      await api('/api/admin/course/settings', { method: 'PUT', body: course });
      flash('ok', 'Course settings saved');
    } catch (e) { flash('err', e instanceof ApiError ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  const addSlide = async () => {
    setBusy(true);
    try { await api('/api/admin/course/slides', { method: 'POST', body: {} }); await load(); }
    catch (e) { flash('err', e instanceof ApiError ? e.message : 'Could not add slide'); }
    finally { setBusy(false); }
  };

  const saveSlide = async (s: AdminSlide) => {
    setBusy(true);
    try {
      await api(`/api/admin/course/slide/${s.id}`, { method: 'PUT', body: s });
      flash('ok', `Slide ${s.slide_number} saved`);
    } catch (e) { flash('err', e instanceof ApiError ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };

  const deleteSlide = async (s: AdminSlide) => {
    if (!window.confirm(`Delete slide ${s.slide_number} "${s.title}"?`)) return;
    await api(`/api/admin/course/slide/${s.id}`, { method: 'DELETE' });
    await load();
  };

  const publish = async () => {
    if (!window.confirm('Publish a new course version? Learners will see this version; learners already in progress keep their current version.')) return;
    setBusy(true);
    try {
      const r = await api<{ version: number }>('/api/admin/course/publish', { method: 'POST', body: {} });
      flash('ok', `Published version ${r.version}`);
      await load();
    } catch (e) { flash('err', e instanceof ApiError ? e.message : 'Publish failed'); }
    finally { setBusy(false); }
  };

  if (!course) return <p><span className="spinner" /> Loading course…</p>;

  return (
    <div>
      {banner && <div className={banner.kind === 'ok' ? 'success-banner' : 'error-banner'}>{banner.text}</div>}

      <div className="admin-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
          <h2 style={{ margin: 0 }}>Course management</h2>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            <span className={`badge ${course.status === 'published' ? 'badge-ok' : 'badge-warn'}`}>
              {course.status === 'published' ? `Published v${course.current_version}` : 'Draft'}
            </span>
            <button className="btn btn-primary" onClick={publish} disabled={busy}>Publish new version</button>
          </div>
        </div>
        <div className="slide-grid" style={{ marginTop: '.8rem' }}>
          <div className="field"><label>Course title</label>
            <input value={course.title} onChange={(e) => setCourse({ ...course, title: e.target.value })} /></div>
          <div className="field"><label>Expected module duration (minutes)</label>
            <input type="number" min={5} max={600} value={course.expected_duration_minutes}
              onChange={(e) => setCourse({ ...course, expected_duration_minutes: Number(e.target.value) })} /></div>
          <div className="field"><label>Inactivity warning after (seconds)</label>
            <input type="number" min={30} max={3600} value={course.inactivity_warning_seconds}
              onChange={(e) => setCourse({ ...course, inactivity_warning_seconds: Number(e.target.value) })} /></div>
          <div className="field"><label>Stop active timer after (seconds inactive)</label>
            <input type="number" min={60} max={7200} value={course.inactivity_stop_seconds}
              onChange={(e) => setCourse({ ...course, inactivity_stop_seconds: Number(e.target.value) })} /></div>
          <div className="field full"><label>Description</label>
            <textarea value={course.description} onChange={(e) => setCourse({ ...course, description: e.target.value })} /></div>
        </div>
        <button className="btn btn-outline btn-sm" style={{ color: 'var(--admin-accent-2)' }} onClick={saveCourseSettings} disabled={busy}>
          Save course settings
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 .6rem' }}>
        <h3 style={{ margin: 0 }}>Slides ({slides.length}/{MAX_SLIDES})</h3>
        <button className="btn btn-primary btn-sm" onClick={addSlide} disabled={busy || slides.length >= MAX_SLIDES}>+ Add slide</button>
      </div>

      {slides.sort((a, b) => a.display_order - b.display_order).map((s) => (
        <SlideRow
          key={s.id}
          slide={s}
          open={openId === s.id}
          onToggle={() => setOpenId(openId === s.id ? null : s.id)}
          onChange={(patch) => patchSlide(s.id, patch)}
          onSave={() => saveSlide(s)}
          onDelete={() => deleteSlide(s)}
          onPreview={() => setPreviewSlide(s)}
          onReview={() => setReviewSlide(s)}
          onUploaded={load}
          flash={flash}
          busy={busy}
        />
      ))}

      {reviewSlide && (
        <KnowledgeReview slideId={reviewSlide.id} slideTitle={reviewSlide.title}
          onClose={() => { setReviewSlide(null); load(); }} />
      )}
      {previewSlide && <SlidePreview slide={previewSlide} onClose={() => setPreviewSlide(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SlideRow(props: {
  slide: AdminSlide;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<AdminSlide>) => void;
  onSave: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onReview: () => void;
  onUploaded: () => Promise<void>;
  flash: (k: 'ok' | 'err', t: string) => void;
}) {
  const { slide: s, open, busy, onToggle, onChange, onSave, onDelete, onPreview, onReview, onUploaded, flash } = props;
  const assetInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<'asset' | 'knowledge' | null>(null);
  const badge = STATUS_BADGE[s.knowledge_status];

  const upload = async (kind: 'asset' | 'knowledge', file: File) => {
    // Frontend validation mirrors the backend checks.
    const allowed = kind === 'asset' ? IMAGE_MIMES : DOC_MIMES;
    const max = kind === 'asset' ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
    if (!allowed.includes(file.type)) { flash('err', `File type not allowed (${file.type || 'unknown'})`); return; }
    if (file.size > max) { flash('err', `File too large (max ${(max / 1048576).toFixed(0)} MB)`); return; }
    setUploading(kind);
    if (kind === 'knowledge') onChange({ knowledge_status: 'processing' });
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api<{ ok: boolean; status?: string; error?: string }>(`/api/admin/upload/${kind}/${s.id}`, { formData: fd });
      if (kind === 'knowledge' && !r.ok) flash('err', `Processing failed: ${r.error}`);
      else flash('ok', kind === 'asset' ? 'Slide visual uploaded' : `Knowledge processed (${r.status})`);
      await onUploaded();
    } catch (e) {
      flash('err', e instanceof ApiError ? e.message : 'Upload failed');
      await onUploaded();
    } finally { setUploading(null); }
  };

  const setQ = (pos: number, patch: Partial<SlideQuestion>) =>
    onChange({
      questions: s.questions.map((q) => (q.position === pos ? { ...q, ...patch } : q)),
    });

  return (
    <div className="slide-row">
      <div className="slide-row-header" onClick={onToggle}>
        <span className="badge badge-dim">#{s.display_order}</span>
        <span className="slide-row-title">Slide {s.slide_number}: {s.title || 'Untitled'}</span>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
        {s.asset_key ? <span className="badge badge-ok">Visual ✓</span> : <span className="badge badge-dim">No visual</span>}
        <span className={`badge ${s.active ? 'badge-ok' : 'badge-dim'}`}>{s.active ? 'Active' : 'Inactive'}</span>
        <span style={{ color: 'var(--admin-dim)' }}>{open ? '▴' : '▾'}</span>
      </div>
      {open && (
        <div className="slide-row-body">
          {/* -------- Upload slots -------- */}
          <div className="slide-grid">
            <div className="upload-slot">
              <span className="slot-title">1 · Slide Asset (visual shown to learner) — PNG / JPG / WEBP, max 8 MB</span>
              {s.asset_key && <img src={`/api/asset/${s.id}?v=${Date.now()}`} alt="Slide visual" />}
              <input ref={assetInput} type="file" accept="image/png,image/jpeg,image/webp" hidden
                onChange={(e) => e.target.files?.[0] && upload('asset', e.target.files[0])} />
              <button className="btn btn-outline btn-sm" style={{ color: 'var(--admin-accent-2)' }}
                onClick={() => assetInput.current?.click()} disabled={uploading !== null}>
                {uploading === 'asset' ? <span className="spinner" /> : s.asset_key ? 'Replace visual' : 'Upload visual'}
              </button>
            </div>
            <div className="upload-slot">
              <span className="slot-title">2 · Knowledge Document (AI trainer source) — PDF / DOCX / TXT, max 15 MB</span>
              <div>
                <span className={`badge ${badge.cls}`}>{badge.label}</span>{' '}
                {s.knowledge_filename && <span style={{ color: 'var(--admin-dim)', fontSize: '.83rem' }}>{s.knowledge_filename}</span>}
              </div>
              {s.knowledge_error && <div className="error-banner">{s.knowledge_error}</div>}
              <input ref={docInput} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden
                onChange={(e) => e.target.files?.[0] && upload('knowledge', e.target.files[0])} />
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                <button className="btn btn-outline btn-sm" style={{ color: 'var(--admin-accent-2)' }}
                  onClick={() => docInput.current?.click()} disabled={uploading !== null}>
                  {uploading === 'knowledge' ? <span className="spinner" /> : 'Upload document'}
                </button>
                {['ready', 'needs_review', 'published'].includes(s.knowledge_status) && (
                  <button className="btn btn-outline btn-sm" style={{ color: 'var(--admin-accent-2)' }} onClick={onReview}>
                    Preview / edit knowledge
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* -------- Fields -------- */}
          <div className="slide-grid">
            <div className="field"><label>Slide number</label>
              <input type="number" min={1} max={MAX_SLIDES} value={s.slide_number}
                onChange={(e) => onChange({ slide_number: Number(e.target.value) })} /></div>
            <div className="field"><label>Display order</label>
              <input type="number" min={1} max={MAX_SLIDES} value={s.display_order}
                onChange={(e) => onChange({ display_order: Number(e.target.value) })} /></div>
            <div className="field full"><label>Slide title</label>
              <input value={s.title} onChange={(e) => onChange({ title: e.target.value })} /></div>
            <div className="field full"><label>Learning objective</label>
              <textarea value={s.learning_objective} onChange={(e) => onChange({ learning_objective: e.target.value })} /></div>
            <div className="field full"><label>Key message</label>
              <textarea value={s.key_message} onChange={(e) => onChange({ key_message: e.target.value })} /></div>
            <div className="field full"><label>Mandatory teaching points (one per line)</label>
              <textarea rows={4} value={s.teaching_points} onChange={(e) => onChange({ teaching_points: e.target.value })} /></div>
            <div className="field full"><label>Restricted / prohibited statements (one per line)</label>
              <textarea rows={3} value={s.restricted_statements} onChange={(e) => onChange({ restricted_statements: e.target.value })} /></div>
            <div className="field"><label>Assessment mode</label>
              <select value={s.assessment_mode} onChange={(e) => onChange({ assessment_mode: e.target.value as AssessmentMode })}>
                <option value="ai">AI-generated</option>
                <option value="admin">Admin-written</option>
                <option value="mixed">Mixed</option>
              </select></div>
            <div className="field"><label>Passing score (%)</label>
              <input type="number" min={0} max={100} value={s.passing_score}
                onChange={(e) => onChange({ passing_score: Number(e.target.value) })} /></div>
            <div className="field"><label>Maximum attempts per question</label>
              <input type="number" min={1} max={5} value={s.max_attempts}
                onChange={(e) => onChange({ max_attempts: Number(e.target.value) })} /></div>
            <div className="field"><label>Status</label>
              <select value={s.active ? '1' : '0'} onChange={(e) => onChange({ active: e.target.value === '1' })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select></div>
          </div>

          {/* -------- Assessment questions -------- */}
          <h4>Assessment questions {s.assessment_mode === 'ai' && <span className="badge badge-info">AI will generate — fields optional</span>}</h4>
          {[1, 2, 3].map((pos) => {
            const q = s.questions.find((x) => x.position === pos)!;
            return (
              <div className="question-block" key={pos}>
                <div className="slide-grid">
                  <div className="field"><label>Question {pos} type</label>
                    <select value={q.question_type} onChange={(e) => setQ(pos, { question_type: e.target.value as SlideQuestion['question_type'] })}>
                      {QTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select></div>
                  <div className="field"><label>Mandatory answer keywords (comma-separated)</label>
                    <input value={q.keywords.join(', ')}
                      onChange={(e) => setQ(pos, { keywords: e.target.value.split(',').map((k) => k.trim()).filter(Boolean) })} /></div>
                  <div className="field full"><label>Question</label>
                    <textarea value={q.question} onChange={(e) => setQ(pos, { question: e.target.value })} /></div>
                  <div className="field full"><label>Expected answer</label>
                    <textarea value={q.expected_answer} onChange={(e) => setQ(pos, { expected_answer: e.target.value })} /></div>
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={onSave} disabled={busy}>Save slide</button>
            <button className="btn btn-outline" style={{ color: 'var(--admin-accent-2)' }} onClick={onPreview}>Preview</button>
            <button className="btn btn-danger" onClick={onDelete} disabled={busy}>Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SlidePreview({ slide, onClose }: { slide: AdminSlide; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <h3>Preview — Slide {slide.slide_number}: {slide.title}</h3>
          <button className="btn btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="slide-visual" style={{ marginBottom: '.8rem' }}>
          {slide.asset_key
            ? <img src={`/api/asset/${slide.id}?v=${Date.now()}`} alt={slide.title} />
            : <div className="missing">No visual uploaded</div>}
        </div>
        <p><strong>Learning objective:</strong> {slide.learning_objective || '—'}</p>
        <p><strong>Key message:</strong> {slide.key_message || '—'}</p>
        <p><strong>Mandatory teaching points:</strong></p>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{slide.teaching_points || '—'}</pre>
        <p><strong>Assessment:</strong> {slide.assessment_mode} · pass ≥ {slide.passing_score}% · max {slide.max_attempts} attempts</p>
      </div>
    </div>
  );
}

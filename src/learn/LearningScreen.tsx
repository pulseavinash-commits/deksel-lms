import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useActivityTimer } from './useActivityTimer';
import Assessment from './Assessment';
import RatingModal from './RatingModal';
import NarrationPlayer, { type NarrationHandle, type NarrationStatus } from './NarrationPlayer';
import type { CoursePayload, LearnSlide, ProgressRow } from './types';
import type { SlideState } from '../../shared/types';

export default function LearningScreen({ learnerName, onSessionExpired }: {
  learnerName: string; onSessionExpired: () => void;
}) {
  const [payload, setPayload] = useState<CoursePayload | null>(null);
  const [loadError, setLoadError] = useState('');
  const [currentSlideId, setCurrentSlideId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ProgressRow>>({});

  // Narration playback state
  const playerRef = useRef<NarrationHandle | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus>('idle');
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [narrationError, setNarrationError] = useState('');
  const [explanationDone, setExplanationDone] = useState(false);

  // Consent / modals
  const [consented, setConsented] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [assetMissing, setAssetMissing] = useState<Record<string, boolean>>({});

  // ------------------------------------------------------------------ load
  const load = useCallback(async () => {
    try {
      const p = await api<CoursePayload>('/api/learn/course');
      setPayload(p);
      const prog: Record<string, ProgressRow> = {};
      for (const r of p.progress) prog[r.slide_id] = r;
      setProgress(prog);
      setConsented(p.session.resume_state?.consent === true);
      const slides = p.course.slides;
      const target = p.session.current_slide_id && slides.some((s) => s.slide_id === p.session.current_slide_id)
        ? p.session.current_slide_id
        : (slides.find((s) => prog[s.slide_id]?.state !== 'slide_completed') ?? slides[0])?.slide_id ?? null;
      setCurrentSlideId(target);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.code === 'SESSION_EXPIRED')) onSessionExpired();
      else setLoadError(e instanceof ApiError ? e.message : 'Could not load the course');
    }
  }, [onSessionExpired]);

  useEffect(() => { load(); }, [load]);

  const slides = payload?.course.slides ?? [];
  const slide: LearnSlide | null = slides.find((s) => s.slide_id === currentSlideId) ?? null;
  const slideIndex = slide ? slides.indexOf(slide) : 0;
  const slideProg = slide ? progress[slide.slide_id] : undefined;
  const slideState: SlideState = slideProg?.state ?? 'not_started';
  const completedCount = Object.values(progress).filter((p) => p.state === 'slide_completed').length;
  const allComplete = slides.length > 0 && completedCount === slides.length;

  // ------------------------------------------------------------------ timer
  const timer = useActivityTimer({
    initialActive: payload?.session.active_seconds ?? 0,
    initialTotal: payload?.session.total_elapsed_seconds ?? 0,
    warnAfter: payload?.course.inactivity_warning_seconds ?? 120,
    stopAfter: payload?.course.inactivity_stop_seconds ?? 300,
    enabled: !!payload && payload.session.status !== 'completed',
  });

  // ------------------------------------------------------------------ autosave helpers
  const sendEvent = useCallback(async (type: string, slideId: string, resume?: Record<string, unknown>) => {
    try {
      await api('/api/learn/progress/event', { method: 'POST', body: { type, slide_id: slideId, resume_state: resume } });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') onSessionExpired();
    }
  }, [onSessionExpired]);

  const setLocalState = useCallback((slideId: string, state: SlideState, score?: number | null) => {
    setProgress((p) => ({
      ...p,
      [slideId]: {
        slide_id: slideId,
        state,
        best_score: score ?? p[slideId]?.best_score ?? null,
        completed_at: state === 'slide_completed' ? new Date().toISOString() : p[slideId]?.completed_at ?? null,
      },
    }));
  }, []);

  // Mark slide opened on navigation; reset per-slide UI state.
  useEffect(() => {
    if (slide) sendEvent('slide_opened', slide.slide_id);
    setExplanationDone(false);
    setNarrationError('');
    setNarrationStatus('idle');
    setAudioPlaying(false);
  }, [currentSlideId]); // eslint-disable-line

  // When the narration finishes, record explanation_completed (never regresses).
  useEffect(() => {
    if (explanationDone && slide &&
        ['not_started', 'explanation_in_progress'].includes(slideState)) {
      sendEvent('explanation_completed', slide.slide_id);
      setLocalState(slide.slide_id, 'explanation_completed');
    }
  }, [explanationDone]); // eslint-disable-line

  // ------------------------------------------------------------------ actions
  const explainSlide = async () => {
    if (!slide) return;
    if (!consented) { setShowConsent(true); return; }
    setNarrationError('');
    try {
      await playerRef.current?.play();
    } catch { /* surfaced via onError */ }
  };

  const onNarrationStarted = () => {
    if (!slide) return;
    sendEvent('explanation_started', slide.slide_id);
    if (slideState === 'not_started') setLocalState(slide.slide_id, 'explanation_in_progress');
  };

  const pausePlayback = () => playerRef.current?.pause();
  const resumePlayback = () => { playerRef.current?.resume().catch(() => undefined); };
  const replay = () => {
    setExplanationDone(false);
    playerRef.current?.replay().catch(() => undefined);
  };

  const finishExplanation = async () => {
    if (!slide) return;
    await sendEvent('explanation_completed', slide.slide_id);
    setLocalState(slide.slide_id, 'explanation_completed');
    setExplanationDone(true);
  };

  const goTo = (id: string) => {
    playerRef.current?.stop();
    setCurrentSlideId(id);
  };
  const canOpen = (s: LearnSlide, idx: number) => {
    if (idx === 0) return true;
    const prev = slides[idx - 1];
    return progress[prev.slide_id]?.state === 'slide_completed' || progress[s.slide_id]?.state === 'slide_completed';
  };

  // ------------------------------------------------------------------ render
  if (loadError) {
    return <div className="learn-root"><div className="learn-gate-wrap">
      <div className="error-banner">{loadError}</div>
      <button className="btn btn-primary" onClick={() => { setLoadError(''); load(); }}>Retry</button>
    </div></div>;
  }
  if (!payload || !slide) {
    return <div className="learn-root"><div className="learn-gate-wrap"><span className="spinner" /> Loading course…</div></div>;
  }

  const expected = payload.course.expected_duration_minutes * 60;
  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const statusBadge: Record<NarrationStatus, { txt: string; dot: string }> = {
    idle: { txt: 'Narration ready', dot: 'dot-dim' },
    preparing: { txt: 'Preparing narration…', dot: 'dot-warn dot-pulse' },
    ready: { txt: 'Ready', dot: 'dot-ok' },
    playing: { txt: 'Playing', dot: 'dot-ok dot-pulse' },
    paused: { txt: 'Paused', dot: 'dot-warn' },
    ended: { txt: 'Explanation finished', dot: 'dot-ok' },
    error: { txt: 'Playback problem', dot: 'dot-bad' },
  };
  const hasAudio = ['ready', 'playing', 'paused', 'ended'].includes(narrationStatus);
  const inAssessment = ['assessment_pending', 'assessment_in_progress', 'corrective_required'].includes(slideState);
  const showAssessment = explanationDone || inAssessment ||
    ['explanation_completed', 'assessment_completed', 'slide_completed'].includes(slideState);

  return (
    <div className="learn-root">
      <header className="learn-topbar">
        <span className="brand">🎓 {payload.course.title}</span>
        <span style={{ color: 'var(--learn-dim)', fontSize: '.85rem' }}>v{payload.course.version} · {learnerName}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '.85rem', color: 'var(--learn-dim)' }}>
          Slide {slideIndex + 1} of {slides.length} · {completedCount} completed
        </span>
      </header>

      {timer.saveFailed && (
        <div className="error-banner" style={{ margin: '0.6rem 1rem' }}>
          ⚠ Progress save failed — retrying automatically. Your completed work is safe; check your internet connection.
        </div>
      )}

      <div className="learn-layout">
        {/* ============ MAIN STAGE ============ */}
        <div className="slide-stage">
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.15rem' }}>Slide {slide.slide_number}: {slide.title}</h2>
            <StateBadge state={slideState} />
          </div>

          <div className="slide-visual">
            {slide.has_asset && !assetMissing[slide.slide_id] ? (
              <img src={`/api/asset/${slide.slide_id}`} alt={slide.title}
                onError={() => setAssetMissing((m) => ({ ...m, [slide.slide_id]: true }))} />
            ) : (
              <div className="missing">
                {slide.has_asset ? '⚠ Slide asset could not be loaded. The narration can still play.' : 'No visual for this slide.'}
              </div>
            )}
          </div>

          {/* Narration player */}
          <NarrationPlayer
            key={slide.slide_id}
            ref={playerRef}
            slideId={slide.slide_id}
            onStarted={onNarrationStarted}
            onEnded={() => setExplanationDone(true)}
            onPlayingChange={(p) => { setAudioPlaying(p); timer.noteAudio(p); }}
            onStatus={setNarrationStatus}
            onError={setNarrationError}
            onSessionExpired={onSessionExpired}
          />

          {narrationError && (
            <div className="error-banner">
              {narrationError}
              <button className="btn btn-outline btn-sm" style={{ marginLeft: 8 }} onClick={explainSlide}>Try again</button>
            </div>
          )}

          {/* Control bar */}
          <div className="control-bar">
            <button className="btn btn-primary" onClick={explainSlide}
              disabled={narrationStatus === 'preparing' || audioPlaying}>
              ▶ Explain This Slide
            </button>
            {audioPlaying
              ? <button className="btn btn-outline" style={{ color: 'var(--learn-accent)' }} onClick={pausePlayback}>⏸ Pause</button>
              : <button className="btn btn-outline" style={{ color: 'var(--learn-accent)' }} onClick={resumePlayback}
                  disabled={narrationStatus !== 'paused'}>⏵ Resume</button>}
            <button className="btn btn-outline" style={{ color: 'var(--learn-accent)' }} onClick={replay}
              disabled={!hasAudio}>↻ Replay Explanation</button>
            <button className="btn btn-outline" style={{ color: 'var(--learn-accent)' }}
              onClick={() => slideIndex > 0 && goTo(slides[slideIndex - 1].slide_id)}
              disabled={slideIndex === 0}>← Previous</button>
            <button className="btn btn-primary"
              onClick={() => slideIndex < slides.length - 1 && goTo(slides[slideIndex + 1].slide_id)}
              disabled={slideState !== 'slide_completed' || slideIndex === slides.length - 1}
              title={slideState !== 'slide_completed' ? 'Complete the explanation and assessment first' : ''}>
              Next Slide →
            </button>
          </div>

          {/* Status strip */}
          <div className="status-strip">
            <span><span className={`status-dot ${statusBadge[narrationStatus].dot}`} />{statusBadge[narrationStatus].txt}</span>
            <span><span className={`status-dot ${audioPlaying ? 'dot-ok dot-pulse' : 'dot-dim'}`} />{audioPlaying ? 'Trainer speaking' : 'Silent'}</span>
          </div>

          {/* Explanation finished → allow moving into assessment */}
          {!showAssessment && slideState === 'explanation_in_progress' && (
            <button className="btn btn-outline btn-sm" style={{ color: 'var(--learn-accent)', alignSelf: 'flex-start' }}
              onClick={finishExplanation}>
              Skip to the assessment
            </button>
          )}

          {/* ============ ASSESSMENT ============ */}
          {showAssessment && (
            <Assessment
              key={slide.slide_id}
              slide={slide}
              slideState={slideState}
              priorAttempts={payload.attempts.filter((a) => a.slide_id === slide.slide_id)}
              onStateChange={(st, score) => {
                setLocalState(slide.slide_id, st, score);
                if (st === 'slide_completed') {
                  const done = Object.values({ ...progress, [slide.slide_id]: { slide_id: slide.slide_id, state: st, best_score: score ?? null, completed_at: '' } })
                    .filter((p) => p.state === 'slide_completed').length;
                  if (done === slides.length && !payload.session.rating_submitted) setShowRating(true);
                }
              }}
              onEvent={(type) => sendEvent(type, slide.slide_id)}
              onSessionExpired={onSessionExpired}
            />
          )}
        </div>

        {/* ============ SIDE PANEL ============ */}
        <div className="side-panel">
          <div className="panel-box">
            <div className="timer-big">{fmt(timer.activeSeconds)}</div>
            <div className="timer-sub">
              Active learning time · expected {payload.course.expected_duration_minutes} min
              <br />Total elapsed: {fmt(timer.totalSeconds)}
            </div>
            <div className="progress-track" style={{ marginTop: '.5rem' }}>
              <div className="progress-fill" style={{ width: `${Math.min(100, (timer.activeSeconds / expected) * 100)}%` }} />
            </div>
            {timer.showWarning && !timer.stopped && (
              <div className="info-banner" style={{ marginTop: '.6rem' }}>
                ⏸ Are you still learning? The active timer pauses when you're inactive.
              </div>
            )}
          </div>

          <div className="panel-box">
            <h4 style={{ marginBottom: '.4rem' }}>Course progress</h4>
            <div className="progress-track" style={{ marginBottom: '.6rem' }}>
              <div className="progress-fill" style={{ width: `${(completedCount / Math.max(1, slides.length)) * 100}%` }} />
            </div>
            <div className="slide-list">
              {slides.map((s, i) => {
                const st = progress[s.slide_id]?.state ?? 'not_started';
                return (
                  <button key={s.slide_id}
                    className={`slide-list-item ${s.slide_id === currentSlideId ? 'current' : ''} ${st === 'slide_completed' ? 'done' : ''}`}
                    onClick={() => canOpen(s, i) && goTo(s.slide_id)}
                    disabled={!canOpen(s, i)}>
                    <span>{st === 'slide_completed' ? '✅' : s.slide_id === currentSlideId ? '▶' : '○'}</span>
                    <span style={{ flex: 1 }}>{s.slide_number}. {s.title}</span>
                    {progress[s.slide_id]?.best_score != null && <span className="badge badge-dim">{progress[s.slide_id].best_score}</span>}
                  </button>
                );
              })}
            </div>
            {allComplete && !payload.session.rating_submitted && (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: '.6rem' }} onClick={() => setShowRating(true)}>
                Finish module — rate the course
              </button>
            )}
            {allComplete && payload.session.rating_submitted && (
              <div className="success-banner">🎉 Module completed. Thank you!</div>
            )}
          </div>

          <div className="panel-box" style={{ fontSize: '.82rem', color: 'var(--learn-dim)' }}>
            <strong>Objective:</strong> {slide.learning_objective || '—'}<br />
            <strong>Key message:</strong> {slide.key_message || '—'}
          </div>
        </div>
      </div>

      {/* Inactivity stop modal */}
      {timer.stopped && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420, textAlign: 'center' }}>
            <h3>Session paused</h3>
            <p>Active-time tracking stopped because you were away. Your progress is saved.</p>
            <button className="btn btn-primary" onClick={timer.confirmReturn}>I'm back — resume learning</button>
          </div>
        </div>
      )}

      {/* Consent modal */}
      {showConsent && (
        <ConsentModal
          privacy={payload.privacy}
          onAccept={async () => {
            setConsented(true); setShowConsent(false);
            await sendEvent('slide_opened', slide.slide_id, { consent: true });
            setTimeout(() => { playerRef.current?.play().catch(() => undefined); }, 50);
          }}
          onDecline={() => setShowConsent(false)}
        />
      )}

      {/* Rating modal */}
      {showRating && (
        <RatingModal onDone={async () => { setShowRating(false); await load(); }} />
      )}
    </div>
  );
}

function StateBadge({ state }: { state: SlideState }) {
  const map: Record<SlideState, { label: string; cls: string }> = {
    not_started: { label: 'Not started', cls: 'badge-dim' },
    explanation_in_progress: { label: 'Explanation in progress', cls: 'badge-info' },
    explanation_completed: { label: 'Explanation completed', cls: 'badge-info' },
    assessment_pending: { label: 'Assessment pending', cls: 'badge-warn' },
    assessment_in_progress: { label: 'Assessment in progress', cls: 'badge-warn' },
    corrective_required: { label: 'Corrective learning required', cls: 'badge-warn' },
    assessment_completed: { label: 'Assessment completed', cls: 'badge-ok' },
    slide_completed: { label: 'Slide completed ✓', cls: 'badge-ok' },
  };
  const b = map[state];
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

function ConsentModal({ privacy, onAccept, onDecline }: {
  privacy: { store_raw_audio: boolean; data_retention_days: number };
  onAccept: () => void; onDecline: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <h3>Before we start — your privacy</h3>
        <ul style={{ lineHeight: 1.7 }}>
          <li>The slide narration is <strong>audio generated by an AI service</strong> (Google Gemini) from your training team's approved content.</li>
          <li><strong>Transcripts of your typed assessment answers are stored</strong> for scoring and reporting to your training team.</li>
          <li>Purpose: evaluating your understanding of this training module and providing corrective coaching.</li>
          <li>Data retention period: <strong>{privacy.data_retention_days} days</strong>.</li>
        </ul>
        <div style={{ display: 'flex', gap: '.6rem', marginTop: '.8rem' }}>
          <button className="btn btn-primary" onClick={onAccept}>I agree — start the narration</button>
          <button className="btn btn-outline" style={{ color: 'var(--learn-dim)' }} onClick={onDecline}>Not now</button>
        </div>
      </div>
    </div>
  );
}

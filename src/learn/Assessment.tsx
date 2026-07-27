import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { AttemptRow, LearnSlide } from './types';
import type { SlideState } from '../../shared/types';

interface Q { position: number; question_type: string; question: string }

interface AnswerResult {
  score: number; passed: boolean; feedback: string;
  analysis: { important_points_missed: string[]; incorrect_statements: string[] };
  corrective_question: string | null;
  attempts_used: number; max_attempts: number;
  slide_state: SlideState; slide_score: number;
}

type Phase = 'loading' | 'ready' | 'scoring' | 'feedback' | 'done' | 'error';

/**
 * Compulsory three-question assessment: recall → understanding → application.
 * Questions can be read aloud with pre-generated audio; answers are typed and
 * scored server-side against the approved knowledge, with corrective learning
 * when the passing score is not met.
 */
export default function Assessment(props: {
  slide: LearnSlide;
  slideState: SlideState;
  priorAttempts: AttemptRow[];
  onStateChange: (state: SlideState, score?: number | null) => void;
  onEvent: (type: string) => void;
  onSessionExpired: () => void;
}) {
  const { slide, slideState, priorAttempts, onStateChange, onEvent, onSessionExpired } = props;

  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<Q[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [corrective, setCorrective] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [resolvedPositions, setResolvedPositions] = useState<Set<number>>(new Set());
  const [speaking, setSpeaking] = useState(false);
  const startedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const completed = slideState === 'slide_completed';

  // ------------------------------------------------------------ load questions
  useEffect(() => {
    if (completed) { setPhase('done'); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ questions: Q[] }>('/api/learn/assessment/questions', {
          method: 'POST', body: { slide_id: slide.slide_id },
        });
        if (cancelled) return;
        const qs = r.questions.sort((a, b) => a.position - b.position);
        setQuestions(qs);
        // Resume support: skip questions already resolved in earlier attempts.
        const resolved = new Set<number>();
        for (const p of [1, 2, 3]) {
          const at = priorAttempts.filter((a) => a.question_position === p);
          if (at.some((a) => a.passed) || at.length >= slide.max_attempts) resolved.add(p);
        }
        setResolvedPositions(resolved);
        const firstUnresolved = qs.findIndex((q) => !resolved.has(q.position));
        if (firstUnresolved === -1) { setPhase('done'); return; }
        setQIndex(firstUnresolved);
        setPhase('ready');
        if (!startedRef.current) {
          startedRef.current = true;
          onEvent('assessment_started');
          onStateChange('assessment_in_progress');
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') { onSessionExpired(); return; }
        setError(e instanceof ApiError ? e.message : 'Could not load the assessment');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; audioRef.current?.pause(); };
  }, [slide.slide_id, completed]); // eslint-disable-line

  const currentQ = questions[qIndex];
  const questionText = corrective ?? currentQ?.question ?? '';

  // Read the current question aloud from pre-generated audio (no live session).
  const hearQuestion = async () => {
    if (!questionText) return;
    setSpeaking(true);
    try {
      const r = await api<{ audio_url: string }>('/api/learn/tts', {
        method: 'POST', body: { text: questionText },
      });
      const a = audioRef.current ?? (audioRef.current = new Audio());
      a.src = r.audio_url;
      a.onended = () => setSpeaking(false);
      a.onerror = () => setSpeaking(false);
      await a.play();
    } catch (e) {
      setSpeaking(false);
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') onSessionExpired();
    }
  };

  // ------------------------------------------------------------ answering
  const submit = async (answerText: string) => {
    const answer = answerText.trim();
    if (!answer) return;
    audioRef.current?.pause();
    setSpeaking(false);
    setPhase('scoring');
    setError('');
    try {
      const r = await api<AnswerResult>('/api/learn/assessment/answer', {
        method: 'POST',
        body: {
          slide_id: slide.slide_id,
          question_position: currentQ.position,
          answer_transcript: answer,
          is_corrective: corrective !== null,
        },
      });
      setResult(r);
      setPhase('feedback');
      setTyped('');
      onStateChange(r.slide_state, r.slide_score);

      if (r.passed || r.attempts_used >= r.max_attempts) {
        setResolvedPositions((s) => new Set(s).add(currentQ.position));
        setCorrective(null);
      } else if (r.corrective_question) {
        setCorrective(r.corrective_question);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') { onSessionExpired(); return; }
      if (e instanceof ApiError && e.code === 'MAX_ATTEMPTS') {
        setResolvedPositions((s) => new Set(s).add(currentQ.position));
        setCorrective(null);
        nextQuestion();
        return;
      }
      setError(e instanceof ApiError ? e.message : 'Could not score your answer — your progress is saved, please retry.');
      setPhase('ready');
    }
  };

  const nextQuestion = () => {
    setResult(null);
    setCorrective(null);
    setTyped('');
    const next = questions.findIndex((q, i) => i > qIndex && !resolvedPositions.has(q.position));
    if (next !== -1) {
      setQIndex(next);
      setPhase('ready');
    } else {
      setPhase('done');
    }
  };

  const retryCorrective = () => {
    setResult(null);
    setTyped('');
    setPhase('ready');
  };

  // ------------------------------------------------------------ render
  if (completed || phase === 'done') {
    return (
      <div className="assessment-area">
        <div className="success-banner">
          ✅ Assessment completed for this slide{completed ? ' (your original result is kept)' : ''}. You can replay the
          explanation any time — your recorded result will not change.
        </div>
      </div>
    );
  }

  return (
    <div className="assessment-area">
      <h3 style={{ fontSize: '1rem' }}>
        📋 Slide assessment — question {Math.min(qIndex + 1, 3)} of 3
        {currentQ && <span className="badge badge-info" style={{ marginLeft: 8 }}>{currentQ.question_type}</span>}
        {corrective && <span className="badge badge-warn" style={{ marginLeft: 8 }}>corrective question</span>}
      </h3>
      {error && <div className="error-banner">{error}</div>}
      {phase === 'loading' && <p><span className="spinner" /> Preparing questions…</p>}

      {currentQ && (phase === 'ready' || phase === 'scoring') && (
        <>
          <div className="assessment-q">{questionText}</div>
          {phase === 'scoring' ? (
            <p><span className="spinner" /> Analyzing your answer…</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <button className="btn btn-outline btn-sm" style={{ color: 'var(--learn-accent)', alignSelf: 'flex-start' }}
                onClick={hearQuestion} disabled={speaking}>
                {speaking ? '🔊 Playing…' : '🔊 Hear the question'}
              </button>
              <label style={{ fontSize: '.85rem', color: 'var(--learn-dim)' }}>Type your answer</label>
              <textarea className="answer-transcript" style={{ width: '100%' }} rows={4}
                value={typed} onChange={(e) => setTyped(e.target.value)}
                placeholder="Write your answer in your own words…" />
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}
                onClick={() => submit(typed)} disabled={!typed.trim()}>Submit answer</button>
            </div>
          )}
        </>
      )}

      {phase === 'feedback' && result && (
        <div>
          <div className={result.passed ? 'success-banner' : 'error-banner'}>
            <strong>{result.passed ? `✓ Passed — score ${result.score}%` : `✗ Score ${result.score}% (pass ≥ ${slide.passing_score}%)`}</strong>
            <br />{result.feedback}
            {result.analysis.important_points_missed.length > 0 && (
              <><br /><strong>Missed:</strong> {result.analysis.important_points_missed.join('; ')}</>
            )}
            {result.analysis.incorrect_statements.length > 0 && (
              <><br /><strong>To correct:</strong> {result.analysis.incorrect_statements.join('; ')}</>
            )}
            <br /><span style={{ fontSize: '.82rem' }}>Attempt {result.attempts_used} of {result.max_attempts}</span>
          </div>
          {result.slide_state === 'slide_completed' ? (
            <button className="btn btn-primary" onClick={() => { setPhase('done'); }}>
              Finish assessment ✓
            </button>
          ) : result.passed || result.attempts_used >= result.max_attempts ? (
            <button className="btn btn-primary" onClick={nextQuestion}>Next question →</button>
          ) : (
            <button className="btn btn-primary" onClick={retryCorrective}>Try the corrective question</button>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api';

export interface TimerState {
  activeSeconds: number;
  totalSeconds: number;
  showWarning: boolean;
  stopped: boolean;       // active counting stopped after prolonged inactivity
  saveFailed: boolean;
}

/**
 * Module timer: primarily tracks ACTIVE learning time.
 * - counts while the tab is visible and the learner interacted (or audio played) recently
 * - shows a warning after `warnAfter` seconds of inactivity
 * - stops active counting after `stopAfter` seconds; resumes when confirmed
 * - syncs deltas to the server every 30 s (and on tab hide) so refreshes never lose time
 */
export function useActivityTimer(opts: {
  initialActive: number;
  initialTotal: number;
  warnAfter: number;
  stopAfter: number;
  enabled: boolean;
}) {
  const { initialActive, initialTotal, warnAfter, stopAfter, enabled } = opts;
  const [state, setState] = useState<TimerState>({
    activeSeconds: initialActive,
    totalSeconds: initialTotal,
    showWarning: false,
    stopped: false,
    saveFailed: false,
  });
  const lastActivity = useRef(Date.now());
  const audioPlaying = useRef(false);
  const pendingActive = useRef(0);
  const pendingInactive = useRef(0);
  const stoppedRef = useRef(false);

  const noteActivity = useCallback(() => {
    lastActivity.current = Date.now();
    if (stoppedRef.current === false) {
      setState((s) => (s.showWarning ? { ...s, showWarning: false } : s));
    }
  }, []);

  const noteAudio = useCallback((playing: boolean) => {
    audioPlaying.current = playing;
    if (playing) lastActivity.current = Date.now();
  }, []);

  /** Learner confirmed they are back. */
  const confirmReturn = useCallback(() => {
    stoppedRef.current = false;
    lastActivity.current = Date.now();
    setState((s) => ({ ...s, stopped: false, showWarning: false }));
  }, []);

  const flush = useCallback(async () => {
    const a = pendingActive.current;
    const i = pendingInactive.current;
    if (a === 0 && i === 0) return;
    pendingActive.current = 0;
    pendingInactive.current = 0;
    try {
      await api('/api/learn/progress/timer', { method: 'POST', body: { active_delta: a, inactive_delta: i } });
      setState((s) => (s.saveFailed ? { ...s, saveFailed: false } : s));
    } catch {
      // Put the deltas back; retry on the next flush.
      pendingActive.current += a;
      pendingInactive.current += i;
      setState((s) => ({ ...s, saveFailed: true }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, noteActivity, { passive: true }));

    const tick = setInterval(() => {
      const idleMs = Date.now() - lastActivity.current;
      const visible = document.visibilityState === 'visible';
      const engaged = visible && (audioPlaying.current || idleMs < warnAfter * 1000);

      if (stoppedRef.current) {
        pendingInactive.current += 1;
        setState((s) => ({ ...s, totalSeconds: s.totalSeconds + 1 }));
        return;
      }
      if (!visible || idleMs >= stopAfter * 1000) {
        // Prolonged inactivity → stop active counting until confirmed.
        if (idleMs >= stopAfter * 1000) {
          stoppedRef.current = true;
          setState((s) => ({ ...s, stopped: true, showWarning: false, totalSeconds: s.totalSeconds + 1 }));
        } else {
          pendingInactive.current += 1;
          setState((s) => ({ ...s, totalSeconds: s.totalSeconds + 1 }));
        }
        return;
      }
      if (engaged) {
        pendingActive.current += 1;
        setState((s) => ({
          ...s,
          activeSeconds: s.activeSeconds + 1,
          totalSeconds: s.totalSeconds + 1,
          showWarning: false,
        }));
      } else {
        pendingInactive.current += 1;
        setState((s) => ({ ...s, totalSeconds: s.totalSeconds + 1, showWarning: true }));
      }
    }, 1000);

    const sync = setInterval(flush, 30_000);
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', () => flush());

    return () => {
      events.forEach((e) => window.removeEventListener(e, noteActivity));
      clearInterval(tick);
      clearInterval(sync);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [enabled, warnAfter, stopAfter, noteActivity, flush]);

  return { ...state, noteAudio, confirmReturn, noteActivity };
}

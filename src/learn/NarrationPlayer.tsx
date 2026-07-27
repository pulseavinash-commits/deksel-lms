import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';

export type NarrationStatus =
  | 'idle' | 'preparing' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

export interface NarrationHandle {
  play: () => Promise<void>;
  pause: () => void;
  resume: () => Promise<void>;
  replay: () => Promise<void>;
  stop: () => void;
}

interface Props {
  slideId: string;
  onStarted: () => void;
  onEnded: () => void;
  onPlayingChange: (playing: boolean) => void;
  onStatus: (s: NarrationStatus) => void;
  onError: (message: string) => void;
  onSessionExpired: () => void;
}

const fmt = (s: number) =>
  Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';

/**
 * Reliable slide narration: pre-generated audio streamed from our own origin
 * and played with a standard <audio> element — no WebSocket, no microphone,
 * no jitter. The first play asks the server to render (and cache) the audio;
 * every play after that is instant.
 */
const NarrationPlayer = forwardRef<NarrationHandle, Props>(function NarrationPlayer(
  { slideId, onStarted, onEnded, onPlayingChange, onStatus, onError, onSessionExpired },
  ref,
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string>('');           // cached audio URL for this slide
  const startedRef = useRef(false);            // onStarted fired once per slide
  const [status, setStatus] = useState<NarrationStatus>('idle');
  const [script, setScript] = useState('');
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);

  const set = (s: NarrationStatus) => { setStatus(s); onStatus(s); };

  // Reset when the slide changes.
  useEffect(() => {
    urlRef.current = '';
    startedRef.current = false;
    setScript(''); setCur(0); setDur(0);
    set('idle');
    const a = audioRef.current;
    if (a) { a.pause(); a.removeAttribute('src'); a.load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slideId]);

  async function ensureLoaded(): Promise<void> {
    if (urlRef.current) return;
    set('preparing');
    const startedAt = Date.now();
    try {
      // The first call starts a background render; we poll until the audio is
      // cached and ready, then point the <audio> element at it.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const r = await api<{ ready: boolean; audio_url?: string; script?: string }>(
          '/api/learn/narration', { method: 'POST', body: { slide_id: slideId } });
        if (r.ready && r.audio_url) {
          urlRef.current = r.audio_url;
          if (r.script) setScript(r.script);
          audioRef.current!.src = r.audio_url;
          return;
        }
        if (Date.now() - startedAt > 150000) {
          throw new Error('The narration is taking longer than expected. Please try again in a moment.');
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
    } catch (e) {
      set('error');
      if (e instanceof ApiError && e.code === 'SESSION_EXPIRED') { onSessionExpired(); return; }
      onError(e instanceof ApiError ? e.message : (e instanceof Error ? e.message : 'Could not prepare the narration.'));
      throw e;
    }
  }

  async function playFromStart(): Promise<void> {
    await ensureLoaded();
    const a = audioRef.current!;
    try { a.currentTime = 0; } catch { /* not seekable yet */ }
    await a.play();
  }

  useImperativeHandle(ref, () => ({
    play: async () => {
      await ensureLoaded();
      await audioRef.current!.play();
    },
    pause: () => audioRef.current?.pause(),
    resume: async () => { await audioRef.current?.play(); },
    replay: async () => { await playFromStart(); },
    stop: () => { const a = audioRef.current; if (a) { a.pause(); try { a.currentTime = 0; } catch { /* noop */ } } },
  }));

  return (
    <div className="narration-player">
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => {
          set('playing');
          onPlayingChange(true);
          if (!startedRef.current) { startedRef.current = true; onStarted(); }
        }}
        onPause={() => {
          if (audioRef.current && !audioRef.current.ended) { set('paused'); onPlayingChange(false); }
        }}
        onEnded={() => { set('ended'); onPlayingChange(false); onEnded(); }}
        onTimeUpdate={() => setCur(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDur(audioRef.current?.duration ?? 0)}
        onError={() => { if (urlRef.current) { set('error'); onError('Audio playback failed.'); } }}
      />

      {status === 'preparing' && (
        <div className="info-banner"><span className="spinner" /> Preparing the narration… the first time on a slide can take up to a minute; after that it plays instantly.</div>
      )}

      {(status === 'playing' || status === 'paused' || status === 'ended' || status === 'ready') && (
        <div className="narration-scrub">
          <span className="narration-time">{fmt(cur)}</span>
          <input
            type="range" min={0} max={dur || 0} step={0.1} value={Math.min(cur, dur || 0)}
            onChange={(e) => { const a = audioRef.current; if (a) { a.currentTime = Number(e.target.value); } }}
            aria-label="Seek narration"
          />
          <span className="narration-time">{fmt(dur)}</span>
        </div>
      )}

      {script && (
        <details className="narration-script">
          <summary>Read along</summary>
          <p>{script}</p>
        </details>
      )}
    </div>
  );
});

export default NarrationPlayer;

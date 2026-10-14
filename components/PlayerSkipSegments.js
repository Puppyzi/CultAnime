'use client';

import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '@videojs/react';
import { safeSegments } from '../lib/skip-segments';
import { useToast } from './Feedback';
import styles from './VideoJsPlayer.module.css';

const SKIP_PROMPT_SECONDS = 8;

function SkipFill({ elapsed, paused, seeking, waiting, playbackRate }) {
  const fillRef = useRef(null);
  const animationRef = useRef(null);

  useEffect(() => {
    const animation = fillRef.current.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: SKIP_PROMPT_SECONDS * 1000, fill: 'both', easing: 'linear' }
    );
    animation.pause();
    animationRef.current = animation;
    return () => {
      animation.cancel();
      animationRef.current = null;
    };
  }, []);

  useEffect(() => {
    const animation = animationRef.current;
    if (!animation) return;
    const stopped = paused || seeking || waiting;
    const target = elapsed * 1000;
    // Let the browser animate continuously between media time updates. Only
    // correct meaningful drift, or snap when paused/seeking, to avoid stutter.
    if (stopped || Math.abs(Number(animation.currentTime) - target) > 100) {
      animation.currentTime = target;
    }
    animation.playbackRate = playbackRate || 1;
    if (stopped) animation.pause();
    else animation.play();
  }, [elapsed, paused, seeking, waiting, playbackRate]);

  return <span ref={fillRef} className={styles.skipSegmentFill} aria-hidden="true" />;
}

export default function PlayerSkipSegments({ episodeId, ready, hidden }) {
  const store = usePlayer();
  const currentTime = usePlayer((state) => state.currentTime);
  const duration = usePlayer((state) => state.duration);
  const seeking = usePlayer((state) => state.seeking);
  const paused = usePlayer((state) => state.paused);
  const waiting = usePlayer((state) => state.waiting);
  const playbackRate = usePlayer((state) => state.playbackRate);
  const notify = useToast();
  const [segments, setSegments] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Stream resolution may populate a previously missing Jellyfin item ID.
    if (!episodeId || !ready) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch(`/api/episodes/${episodeId}/segments`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && data?.episodeId === episodeId && Array.isArray(data.segments)) {
          setSegments(data.segments);
        }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [episodeId, ready]);

  const active = safeSegments(segments, duration).find(
    (segment) =>
      currentTime >= segment.start &&
      currentTime < Math.min(segment.end, segment.start + SKIP_PROMPT_SECONDS)
  );
  if (hidden || !active) return null;

  // Use the playback timeline so pausing freezes the fill and rewinding restores it.
  // Expiring the prompt never changes the actual intro/credits skip destination.
  const progress = (currentTime - active.start) / SKIP_PROMPT_SECONDS;

  return (
    <button
      type="button"
      className={styles.skipSegment}
      style={{ '--skip-progress': progress }}
      disabled={busy || seeking}
      onClick={async (event) => {
        event.stopPropagation();
        setBusy(true);
        try {
          // The player routes this to local playback or the active Cast receiver.
          await store.seek(active.end);
        } catch {
          notify('Could not skip. Please try again.', 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <SkipFill
        key={`${active.type}:${active.start}:${active.end}`}
        elapsed={currentTime - active.start}
        paused={paused}
        seeking={seeking}
        waiting={waiting}
        playbackRate={playbackRate}
      />
      <span className={styles.skipSegmentLabel}>
        {active.type === 'intro' ? 'Skip Intro' : 'Skip Credits'}
      </span>
    </button>
  );
}

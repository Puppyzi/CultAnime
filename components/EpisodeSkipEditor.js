'use client';

import { useEffect, useState } from 'react';
import { SKIP_TYPES } from '../lib/skip-segments';
import { useToast } from './Feedback';
import styles from './EpisodeSkipEditor.module.css';

const names = { intro: 'Intro', outro: 'Credits' };

export default function EpisodeSkipEditor({ episodeId }) {
  const notify = useToast();
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);

  function accept(result) {
    setData(result);
    setSettings(
      Object.fromEntries(
        SKIP_TYPES.map((type) => [
          type,
          {
            mode: result.types[type].mode,
            segments: result.types[type].segments.map((s) => ({
              start: String(s.start),
              end: String(s.end),
            })),
          },
        ])
      )
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timer = setTimeout(() => controller.abort(), 8000);
    fetch(`/api/admin/episodes/${episodeId}/segments`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not load skip settings.');
        if (!controller.signal.aborted && !disposed) accept(result);
      })
      .catch((error) => {
        if (disposed) return;
        if (!controller.signal.aborted) setError(error.message);
        else setError('Could not load skip settings. Try refreshing.');
      })
      .finally(() => {
        clearTimeout(timer);
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [episodeId, revision]);

  function update(type, changes) {
    setSettings((current) => ({ ...current, [type]: { ...current[type], ...changes } }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/episodes/${episodeId}/segments`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          mediaKey: data.mediaKey,
          ...Object.fromEntries(
            SKIP_TYPES.map((type) => [
              type,
              {
                mode: settings[type].mode,
                segments: settings[type].segments.map((s) => ({
                  start: Number(s.start),
                  end: Number(s.end),
                })),
              },
            ])
          ),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not save skip settings.');
      accept(result);
      notify('Skip settings saved. Reopen the episode to use the new times.', 'success');
    } catch (error) {
      setError(
        error.name === 'TimeoutError'
          ? 'Saving timed out. Refresh to check the saved settings.'
          : error.message
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.editor} onSubmit={save} aria-label="Episode skip settings">
      <div className={styles.heading}>
        <h4>Intro and credits</h4>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading || saving}
          onClick={() => {
            setLoading(true);
            setError('');
            setRevision((value) => value + 1);
          }}
        >
          Refresh detected times
        </button>
      </div>
      <p>Choose skip behavior for this episode. Times are seconds from the beginning of the video.</p>
      {loading ? (
        <p role="status">Loading skip settings…</p>
      ) : (
        settings && (
          <>
            {data.detectionStatus === 'unavailable' && (
              <p>Automatic timestamps are unavailable. Check the Jellyfin connection and segment provider.</p>
            )}
            {data.detectionStatus === 'unknown' && (
              <p>No automatic timestamps found. The episode may not have been analyzed yet.</p>
            )}
            {SKIP_TYPES.map((type) => (
              <fieldset key={type} disabled={saving || !data.mediaKey} className={styles.group}>
                <legend>{names[type]}</legend>
                {data.types[type].stale && (
                  <p role="status">
                    The file changed or could not be verified. Skipping is hidden until you review and save
                    these settings.
                  </p>
                )}
                <label>
                  {names[type]} behavior
                  <select
                    className="form-input"
                    value={settings[type].mode}
                    onChange={(event) =>
                      update(type, {
                        mode: event.target.value,
                        segments: settings[type].segments.length
                          ? settings[type].segments
                          : [{ start: '', end: '' }],
                      })
                    }
                  >
                    <option value="auto">Use detected times</option>
                    <option value="custom">Set custom times</option>
                    <option value="absent">
                      No {type === 'intro' ? 'intro' : 'credits'} in this episode
                    </option>
                    <option value="disabled">Do not offer skipping</option>
                  </select>
                </label>
                {settings[type].mode === 'auto' && (
                  <p>
                    {data.detectedSegments.some((s) => s.type === type)
                      ? data.detectedSegments
                          .filter((s) => s.type === type)
                          .map((s) => `${s.start}s–${s.end}s`)
                          .join(', ')
                      : 'No skip button will be shown without valid detected times.'}
                  </p>
                )}
                {settings[type].mode === 'custom' && (
                  <>
                    {settings[type].segments.map((segment, index) => (
                      <div className={styles.interval} key={index}>
                        {['start', 'end'].map((boundary) => (
                          <label key={boundary}>
                            {names[type]} {boundary} {index + 1} (seconds)
                            <input
                              className="form-input"
                              type="number"
                              min="0"
                              max={data.duration || undefined}
                              step="any"
                              required
                              value={segment[boundary]}
                              onChange={(event) =>
                                update(type, {
                                  segments: settings[type].segments.map((s, i) =>
                                    i === index ? { ...s, [boundary]: event.target.value } : s
                                  ),
                                })
                              }
                            />
                          </label>
                        ))}
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={settings[type].segments.length === 1}
                          onClick={() =>
                            update(type, { segments: settings[type].segments.filter((_, i) => i !== index) })
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={settings[type].segments.length >= 10}
                      onClick={() =>
                        update(type, { segments: [...settings[type].segments, { start: '', end: '' }] })
                      }
                    >
                      Add interval
                    </button>
                  </>
                )}
              </fieldset>
            ))}
            <p>
              Credits should end before any post-credit scene. Custom times and disabled skips take priority
              over future detection results.
            </p>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !data.mediaKey}>
              {saving ? 'Saving…' : 'Save skip settings'}
            </button>
          </>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

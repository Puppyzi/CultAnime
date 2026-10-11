'use client';

import { useState } from 'react';
import {
  AirPlayButton,
  BufferingIndicator,
  Container,
  Controls,
  FullscreenButton,
  Gesture,
  Hotkey,
  MuteButton,
  PiPButton,
  PlayButton,
  Popover,
  SeekButton,
  StatusAnnouncer,
  Time,
  TimeSlider,
  VolumeSlider,
} from '@videojs/react';
import { Video, VideoPlayer } from '@videojs/react/video';
import styles from './VideoJsPlayer.module.css';

function Icon({ name }) {
  const paths = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: (
      <>
        <path d="M8 5v14M16 5v14" />
      </>
    ),
    volume: (
      <>
        <path d="m11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
      </>
    ),
    muted: (
      <>
        <path d="m11 5-6 4H2v6h3l6 4ZM16 9l6 6M22 9l-6 6" />
      </>
    ),
    fullscreen: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
    airplay: <path d="M5 17H3V4h18v13h-2M12 14l7 7H5Z" />,
    pip: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 12h6v5h-6z" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    next: (
      <>
        <path d="m5 5 11 7-11 7ZM19 5v14" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function TrackSelect({ label, value, options, disabled, onChange }) {
  return (
    <label className={styles.setting}>
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Video.js owns the controls, accessibility, fullscreen and interaction state.
// The watch page owns the media source and its single hls.js instance: Jellyfin
// track changes negotiate new sessions and cannot use manifest-only track menus.
export default function VideoJsPlayer({
  videoRef,
  title,
  audioTracks,
  selectedAudioTrack,
  onAudioChange,
  subtitles,
  selectedSubtitle,
  onSubtitleChange,
  playbackRate,
  onPlaybackRateChange,
  autoplayNext,
  onAutoplayNextChange,
  onShowShortcuts,
  shortcutsOpen,
  onNextEpisode,
  streamLoading,
  streamError,
  onRetry,
  ...videoProps
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <VideoPlayer title={title}>
      <Container className={styles.player} data-cultanime-player="videojs" aria-label={title}>
        <Video
          ref={videoRef}
          className={styles.video}
          playsInline
          preload="none"
          crossOrigin="anonymous"
          {...videoProps}
        />
        {streamError ? (
          <div className={styles.error} role="alert">
            <strong>Playback interrupted</strong>
            <p>{streamError}</p>
            <p>Your playback position is saved for retry.</p>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                onRetry();
              }}
              disabled={streamLoading}
            >
              Retry playback
            </button>
          </div>
        ) : (
          <>
            <BufferingIndicator className={styles.buffering}>
              <span className={styles.spinner} />
            </BufferingIndicator>
            {streamLoading && (
              <div className={styles.loading} role="status">
                Connecting…
              </div>
            )}
            <Controls.Root visibility={settingsOpen ? 'always' : 'auto'}>
              <Controls.Content className={styles.controls}>
                <div className={styles.title}>{title}</div>
                <div className={styles.bottom}>
                  <TimeSlider.Root className={styles.timeline} label="Seek" step={10}>
                    <TimeSlider.Track className={styles.track}>
                      <TimeSlider.Buffer className={styles.buffer} />
                      <TimeSlider.Fill className={styles.fill} />
                    </TimeSlider.Track>
                    <TimeSlider.Thumb className={styles.thumb} />
                    <TimeSlider.Preview className={styles.preview}>
                      <TimeSlider.Value type="pointer" />
                    </TimeSlider.Preview>
                  </TimeSlider.Root>
                  <Controls.Group className={styles.bar} aria-label="Playback controls">
                    <PlayButton
                      className={styles.button}
                      render={(props, state) => (
                        <button {...props}>
                          <Icon name={state.paused ? 'play' : 'pause'} />
                        </button>
                      )}
                    />
                    <SeekButton
                      className={`${styles.button} ${styles.seek}`}
                      seconds={-10}
                      title="Back 10 seconds"
                    >
                      ↶<small>10</small>
                    </SeekButton>
                    <SeekButton
                      className={`${styles.button} ${styles.seek}`}
                      seconds={10}
                      title="Forward 10 seconds"
                    >
                      ↷<small>10</small>
                    </SeekButton>
                    <MuteButton
                      className={styles.button}
                      render={(props, state) => (
                        <button {...props}>
                          <Icon name={state.muted || state.volume === 0 ? 'muted' : 'volume'} />
                        </button>
                      )}
                    />
                    <VolumeSlider.Root className={styles.volume} label="Volume">
                      <VolumeSlider.Track className={styles.track}>
                        <VolumeSlider.Fill className={styles.fill} />
                      </VolumeSlider.Track>
                      <VolumeSlider.Thumb className={styles.thumb} />
                    </VolumeSlider.Root>
                    <div className={styles.time}>
                      <Time.Value type="current" />
                      <span> / </span>
                      <Time.Value type="duration" />
                    </div>
                    <div className={styles.spacer} />
                    {onNextEpisode && (
                      <button
                        className={`${styles.button} ${styles.next}`}
                        type="button"
                        aria-label="Next episode"
                        title="Next episode"
                        onClick={onNextEpisode}
                      >
                        <Icon name="next" />
                      </button>
                    )}
                    <Popover.Root side="top" align="end" onOpenChange={setSettingsOpen}>
                      <Popover.Trigger
                        className={styles.button}
                        aria-label="Player settings"
                        title="Player settings"
                      >
                        <Icon name="settings" />
                      </Popover.Trigger>
                      <Popover.Popup className={styles.settings} aria-label="Player settings">
                        <strong>Playback settings</strong>
                        {audioTracks.length > 1 && (
                          <TrackSelect
                            label="Audio"
                            value={selectedAudioTrack}
                            disabled={streamLoading}
                            onChange={onAudioChange}
                            options={[
                              { value: 'default', label: 'Default' },
                              ...audioTracks.map((track) => ({
                                value: String(track.index),
                                label: track.title || track.language || `Audio ${track.index}`,
                              })),
                            ]}
                          />
                        )}
                        {subtitles.length > 0 && (
                          <TrackSelect
                            label="Subtitles"
                            value={selectedSubtitle}
                            disabled={streamLoading}
                            onChange={onSubtitleChange}
                            options={[
                              { value: 'off', label: 'Off' },
                              ...subtitles.map((track) => ({
                                value: String(track.index),
                                label: track.title || track.language || `Subtitle ${track.index}`,
                              })),
                            ]}
                          />
                        )}
                        <TrackSelect
                          label="Speed"
                          value={String(playbackRate)}
                          onChange={onPlaybackRateChange}
                          options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
                            value: String(rate),
                            label: `${rate}×`,
                          }))}
                        />
                        <label className={styles.setting}>
                          <span>Autoplay next episode</span>
                          <input type="checkbox" checked={autoplayNext} onChange={onAutoplayNextChange} />
                        </label>
                        <button type="button" className={styles.help} onClick={onShowShortcuts}>
                          Keyboard shortcuts
                        </button>
                      </Popover.Popup>
                    </Popover.Root>
                    <AirPlayButton className={styles.button} title="AirPlay">
                      <Icon name="airplay" />
                    </AirPlayButton>
                    <PiPButton className={`${styles.button} ${styles.pip}`} title="Picture in picture">
                      <Icon name="pip" />
                    </PiPButton>
                    <FullscreenButton className={styles.button} title="Toggle fullscreen">
                      <Icon name="fullscreen" />
                    </FullscreenButton>
                  </Controls.Group>
                </div>
              </Controls.Content>
            </Controls.Root>
            <Hotkey keys="Space" action="togglePaused" target="document" disabled={shortcutsOpen} />
            <Hotkey keys="k" action="togglePaused" target="document" disabled={shortcutsOpen} />
            <Hotkey keys="m" action="toggleMuted" target="document" disabled={shortcutsOpen} />
            <Hotkey keys="f" action="toggleFullscreen" target="document" disabled={shortcutsOpen} />
            <Hotkey
              keys="ArrowLeft"
              action="seekStep"
              value={-10}
              target="document"
              disabled={shortcutsOpen}
            />
            <Hotkey
              keys="ArrowRight"
              action="seekStep"
              value={10}
              target="document"
              disabled={shortcutsOpen}
            />
            <Gesture type="tap" action="togglePaused" pointer="mouse" region="center" />
            <Gesture type="tap" action="toggleControls" pointer="touch" />
            <Gesture type="doubletap" action="seekStep" value={-10} region="left" />
            <Gesture type="doubletap" action="seekStep" value={10} region="right" />
            <StatusAnnouncer className="sr-only" />
          </>
        )}
      </Container>
    </VideoPlayer>
  );
}

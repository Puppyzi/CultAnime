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
  SeekButton,
  StatusAnnouncer,
  Time,
  TimeSlider,
  VolumeSlider,
} from '@videojs/react';
import { SeekIcon } from '@videojs/react/icons';
import PlayerSettings from './PlayerSettings';
import PlayerSkipSegments from './PlayerSkipSegments';
import PlayerCasting, { PlayerStoreBridge } from './PlayerCasting';
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

// Video.js owns the controls, accessibility, fullscreen and interaction state.
// The watch page owns the media source and its single hls.js instance: Jellyfin
// track changes negotiate new sessions and cannot use manifest-only track menus.
export default function VideoJsPlayer({
  episodeId,
  videoRef,
  playerStoreRef,
  castSource,
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
      <PlayerStoreBridge playerStoreRef={playerStoreRef} />
      <Container className={styles.player} data-cultanime-player="videojs" aria-label={title}>
        <Video
          ref={videoRef}
          className={styles.video}
          playsInline
          // Native sources need metadata to restore position after a paused track change.
          preload="metadata"
          crossOrigin="anonymous"
          {...videoProps}
        />
        <PlayerSkipSegments
          key={episodeId}
          episodeId={episodeId}
          ready={!streamLoading}
          hidden={streamLoading || Boolean(streamError) || settingsOpen || shortcutsOpen}
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
                      <svg viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
                        <path d="M9 1a7.98 7.98 0 0 0-6.132 2.867l-1.441-1.44A.25.25 0 0 0 1 2.604V6.75c0 .138.112.25.25.25h4.146a.25.25 0 0 0 .177-.427L4.29 5.29A5.99 5.99 0 0 1 9 3a6 6 0 0 1 4.242 10.242l1.415 1.415A8 8 0 0 0 9 1" />
                      </svg>
                      <small aria-hidden="true">10</small>
                    </SeekButton>
                    <SeekButton
                      className={`${styles.button} ${styles.seek}`}
                      seconds={10}
                      title="Forward 10 seconds"
                    >
                      <SeekIcon />
                      <small aria-hidden="true">10</small>
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
                    <button
                      className={`${styles.button} ${styles.autoplayButton}`}
                      type="button"
                      role="switch"
                      aria-label="Autoplay next episode"
                      aria-checked={autoplayNext}
                      title={`Autoplay next episode: ${autoplayNext ? 'On' : 'Off'}`}
                      onClick={onAutoplayNextChange}
                    >
                      <span className={styles.autoplayTrack} aria-hidden="true">
                        <span className={styles.autoplayThumb}>
                          <svg viewBox="0 0 12 12" fill="currentColor">
                            {autoplayNext ? <path d="M4 2.5 9 6 4 9.5Z" /> : <path d="M3 3h2v6H3zm4 0h2v6H7z" />}
                          </svg>
                        </span>
                      </span>
                    </button>
                    <PlayerSettings
                      open={settingsOpen}
                      onOpenChange={setSettingsOpen}
                      audioTracks={audioTracks}
                      selectedAudioTrack={selectedAudioTrack}
                      onAudioChange={onAudioChange}
                      subtitles={subtitles}
                      selectedSubtitle={selectedSubtitle}
                      onSubtitleChange={onSubtitleChange}
                      playbackRate={playbackRate}
                      onPlaybackRateChange={onPlaybackRateChange}
                      streamLoading={streamLoading}
                    />
                    <AirPlayButton className={styles.button} title="AirPlay">
                      <Icon name="airplay" />
                    </AirPlayButton>
                    <PlayerCasting source={castSource} loading={streamLoading || Boolean(streamError)} />
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
            <Hotkey
              keys="Space"
              action="togglePaused"
              target="document"
              disabled={shortcutsOpen || settingsOpen}
            />
            <Hotkey
              keys="k"
              action="togglePaused"
              target="document"
              disabled={shortcutsOpen || settingsOpen}
            />
            <Hotkey
              keys="m"
              action="toggleMuted"
              target="document"
              disabled={shortcutsOpen || settingsOpen}
            />
            <Hotkey
              keys="f"
              action="toggleFullscreen"
              target="document"
              disabled={shortcutsOpen || settingsOpen}
            />
            <Hotkey
              keys="ArrowLeft"
              action="seekStep"
              value={-10}
              target="document"
              disabled={shortcutsOpen || settingsOpen}
            />
            <Hotkey
              keys="ArrowRight"
              action="seekStep"
              value={10}
              target="document"
              disabled={shortcutsOpen || settingsOpen}
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

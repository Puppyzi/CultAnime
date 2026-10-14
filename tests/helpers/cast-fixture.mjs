// Exercise the real Video.js Cast extension against a simulated Google sender
// SDK. This verifies our integration, not Chromecast hardware/codec support.
export async function prepareCast(page) {
  await page.addInitScript(() => {
    const enumOf = (...keys) => Object.fromEntries(keys.map((key) => [key, key]));
    const remoteTypes = enumOf(
      'IS_CONNECTED_CHANGED',
      'DURATION_CHANGED',
      'VOLUME_LEVEL_CHANGED',
      'IS_MUTED_CHANGED',
      'CURRENT_TIME_CHANGED',
      'VIDEO_INFO_CHANGED',
      'IS_PAUSED_CHANGED',
      'PLAYER_STATE_CHANGED',
      'IS_MEDIA_LOADED_CHANGED'
    );
    const listeners = new Map();
    let remote;
    let connected = false;
    const loads = [];
    const media = {
      playbackRate: 1,
      addUpdateListener() {},
      removeUpdateListener() {},
      editTracksInfo(request, success) {
        success();
      },
      getStatus(request, success) {
        success();
      },
    };
    const emit = (type, value) => {
      for (const callback of listeners.get(type) || []) callback({ type, value });
    };
    const session = {
      getSessionObj: () => ({ media: [media] }),
      async loadMedia(request) {
        loads.push(request);
        media.media = request.media;
        Object.assign(remote, {
          isMediaLoaded: true,
          currentTime: request.currentTime,
          duration: 30,
          isPaused: !request.autoplay,
          mediaInfo: request.media,
          playerState: request.autoplay ? 'PLAYING' : 'PAUSED',
        });
        emit('IS_MEDIA_LOADED_CHANGED', true);
        emit('DURATION_CHANGED', 30);
        emit('CURRENT_TIME_CHANGED', remote.currentTime);
        emit('IS_PAUSED_CHANGED', remote.isPaused);
        emit('PLAYER_STATE_CHANGED', remote.playerState);
      },
      async sendMessage(namespace, message) {
        media.playbackRate = message.playbackRate;
      },
    };
    const context = {
      setOptions() {},
      addEventListener() {},
      getCastState: () => (connected ? 'CONNECTED' : 'NOT_CONNECTED'),
      getSessionState: () => (connected ? 'SESSION_STARTED' : 'NO_SESSION'),
      getCurrentSession: () => (connected ? session : null),
      async requestSession() {
        if (connected) {
          this.endCurrentSession(true);
          return;
        }
        connected = true;
        emit('IS_CONNECTED_CHANGED', true);
      },
      endCurrentSession() {
        remote.savedPlayerState = { currentTime: remote.currentTime, isPaused: remote.isPaused };
        connected = false;
        emit('IS_CONNECTED_CHANGED', false);
      },
    };
    class RemotePlayer {
      constructor() {
        remote = this;
        Object.assign(this, {
          isMediaLoaded: false,
          currentTime: 0,
          duration: 30,
          isPaused: true,
          isMuted: false,
          volumeLevel: 0.4,
        });
      }
    }
    class RemotePlayerController {
      constructor(player) {
        player.controller = this;
      }
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      }
      removeEventListener(type, callback) {
        listeners.get(type)?.delete(callback);
      }
      playOrPause() {
        remote.isPaused = !remote.isPaused;
        emit('IS_PAUSED_CHANGED', remote.isPaused);
      }
      seek() {
        emit('CURRENT_TIME_CHANGED', remote.currentTime);
      }
      muteOrUnmute() {
        remote.isMuted = !remote.isMuted;
        emit('IS_MUTED_CHANGED', remote.isMuted);
      }
      setVolumeLevel() {
        emit('VOLUME_LEVEL_CHANGED', remote.volumeLevel);
      }
    }
    window.chrome ||= {};
    window.chrome.cast = {
      isAvailable: true,
      AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
      Image: class {
        constructor(url) {
          this.url = url;
        }
      },
      media: {
        MediaInfo: class {
          constructor(contentId, contentType) {
            Object.assign(this, { contentId, contentType });
          }
        },
        LoadRequest: class {
          constructor(info) {
            this.media = info;
          }
        },
        GenericMediaMetadata: class {},
        Track: class {
          constructor(trackId, type) {
            Object.assign(this, { trackId, type });
          }
        },
        EditTracksInfoRequest: class {},
        GetStatusRequest: class {},
        TrackType: { TEXT: 'TEXT' },
        TextTrackType: enumOf('CAPTIONS', 'SUBTITLES'),
        StreamType: enumOf('LIVE', 'BUFFERED'),
        HlsSegmentFormat: enumOf('FMP4', 'TS'),
        HlsVideoSegmentFormat: enumOf('FMP4', 'TS'),
        PlayerState: enumOf('IDLE', 'PLAYING', 'PAUSED', 'BUFFERING'),
        IdleReason: { FINISHED: 'FINISHED' },
      },
    };
    window.cast = {
      framework: {
        CastContext: { getInstance: () => context },
        RemotePlayer,
        RemotePlayerController,
        RemotePlayerEventType: remoteTypes,
        CastState: enumOf('NO_DEVICES_AVAILABLE', 'NOT_CONNECTED', 'CONNECTING', 'CONNECTED'),
        CastContextEventType: enumOf('CAST_STATE_CHANGED', 'SESSION_STATE_CHANGED'),
        SessionState: { SESSION_RESUMED: 'SESSION_RESUMED' },
      },
    };
    window.castTest = {
      loads,
      get currentTime() {
        return remote.currentTime;
      },
      advance(time) {
        remote.currentTime = time;
        emit('CURRENT_TIME_CHANGED', time);
      },
      get connected() {
        return connected;
      },
    };
  });
}

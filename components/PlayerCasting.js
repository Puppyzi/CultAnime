'use client';

import { useEffect } from 'react';
import { CastButton, usePlayer } from '@videojs/react';
import { GoogleCast } from '@videojs/react/extensions/google-cast';
import { CastEnterIcon, CastExitIcon } from '@videojs/react/icons';
import styles from './VideoJsPlayer.module.css';

// Keep the final snapshot available to the watch page's unmount/history cleanup.
export function PlayerStoreBridge({ playerStoreRef }) {
  const store = usePlayer();
  useEffect(() => {
    playerStoreRef.current = store;
  }, [playerStoreRef, store]);
  return null;
}

export default function PlayerCasting({ source, loading }) {
  const connected = usePlayer((state) => state.remotePlaybackState === 'connected');
  const hostname = source ? new URL(source).hostname : '';
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\./.test(hostname);
  const blocked = !source || loopback || loading;
  return (
    <>
      <GoogleCast src={source || ''} streamType="on-demand" />
      <CastButton
        className={styles.button}
        disabled={!connected && blocked}
        render={(props) => (
          <button
            {...props}
            onClick={(event) => {
              if (connected) {
                // End explicitly: the 10.0.1 provider's picker path reloads the
                // local media after disconnecting, losing its restored position.
                window.cast?.framework?.CastContext.getInstance().endCurrentSession(true);
              } else {
                props.onClick?.(event);
              }
            }}
            title="Start casting"
          >
            {connected ? <CastExitIcon /> : <CastEnterIcon />}
          </button>
        )}
      />
    </>
  );
}

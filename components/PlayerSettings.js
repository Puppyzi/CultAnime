'use client';

import { Menu, usePlayer } from '@videojs/react';
import {
  CaptionsOnIcon,
  CheckIcon,
  ChevronIcon,
  GearIcon,
  PlayIcon,
  SpeedIcon,
  VolumeHighIcon,
} from '@videojs/react/icons';
import styles from './VideoJsPlayer.module.css';

function SettingsChoices({ label, icon, value, options, disabled, onChange }) {
  const selected = options.find((option) => option.value === value);

  return (
    <Menu.Root>
      <Menu.Trigger
        className={styles.menuRow}
        aria-label={label}
        aria-description={selected?.label}
        disabled={disabled}
      >
        {icon}
        <span>{label}</span>
        <span className={styles.menuHint}>
          <span title={selected?.label}>{selected?.label}</span>
          <ChevronIcon className={styles.menuChevron} />
        </span>
      </Menu.Trigger>
      <Menu.Content
        className={`${styles.menuContent} ${label === 'Speed' ? styles.speedMenu : ''}`}
        aria-label={label}
      >
        <Menu.Item
          className={`${styles.menuRow} ${styles.menuBack}`}
          aria-label={`Back to settings from ${label}`}
        >
          <ChevronIcon className={styles.menuBackIcon} />
          <span>{label}</span>
        </Menu.Item>
        <Menu.RadioGroup
          className={styles.menuOptions}
          value={value}
          onValueChange={onChange}
          aria-label={label}
        >
          {options.map((option) => (
            <Menu.RadioItem
              className={styles.menuRow}
              key={option.value}
              value={option.value}
              disabled={disabled}
            >
              <span className={styles.optionLabel}>{option.label}</span>
              <Menu.ItemIndicator checked={option.value === value} forceMount className={styles.menuCheck}>
                <CheckIcon />
              </Menu.ItemIndicator>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

// Use Video.js navigation and animation state with Jellyfin's full track list.
// Manifest-backed option groups cannot negotiate our server-side track changes.
export default function PlayerSettings({
  open,
  onOpenChange,
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
  streamLoading,
}) {
  const casting = usePlayer((state) => state.remotePlaybackState !== 'disconnected');
  const store = usePlayer();
  return (
    <Menu.Root side="top" align="end" open={open} onOpenChange={onOpenChange}>
      <Menu.Trigger className={styles.button} aria-label="Settings" title="Settings">
        <GearIcon className={styles.settingsIcon} />
      </Menu.Trigger>
      <Menu.Popup className={styles.settings} keepMounted>
        <Menu.Content className={styles.menuContent} aria-label="Player settings">
          {casting && <p className={styles.castHint}>Stop casting to change audio or subtitles.</p>}
          {audioTracks.length > 1 && (
            <SettingsChoices
              label="Audio"
              icon={<VolumeHighIcon />}
              value={selectedAudioTrack}
              disabled={streamLoading || casting}
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
            <SettingsChoices
              label="Subtitles"
              icon={<CaptionsOnIcon />}
              value={selectedSubtitle}
              disabled={streamLoading || casting}
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
          <SettingsChoices
            label="Speed"
            icon={<SpeedIcon />}
            value={String(playbackRate)}
            onChange={(rate) => {
              if (casting) store.setPlaybackRate(Number(rate));
              else onPlaybackRateChange(rate);
            }}
            options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({
              value: String(rate),
              label: `${rate}×`,
            }))}
          />
          <Menu.Separator className={styles.menuSeparator} />
          <Menu.CheckboxItem
            className={styles.menuRow}
            checked={autoplayNext}
            onCheckedChange={onAutoplayNextChange}
            aria-label="Autoplay next episode"
          >
            <PlayIcon />
            <span>Autoplay next episode</span>
            <span className={styles.menuSwitch} aria-hidden="true" />
          </Menu.CheckboxItem>
        </Menu.Content>
      </Menu.Popup>
    </Menu.Root>
  );
}

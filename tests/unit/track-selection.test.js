import { describe, expect, it } from 'vitest';
import { chooseAudioTrack, chooseSubtitle, requiresBurnedInSubtitle } from '../../lib/track-selection';

describe('track selection', () => {
  it('prefers Japanese audio and full English subtitles', () => {
    const audio = [{ index: 1, language: 'eng', isDefault: true }, { index: 2, language: 'jpn' }];
    const subtitles = [{ index: 3, title: 'English Signs' }, { index: 4, title: 'English Full Dialogue' }];
    expect(chooseAudioTrack(audio, null).index).toBe(2);
    expect(chooseSubtitle(subtitles, null).index).toBe(4);
  });

  it('honors explicit choices and identifies image-styled subtitle formats', () => {
    expect(chooseSubtitle([{ index: 7 }, { index: 8 }], 8).index).toBe(8);
    expect(requiresBurnedInSubtitle({ codec: 'ASS' })).toBe(true);
  });
});

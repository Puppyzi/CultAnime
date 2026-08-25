import { describe, expect, it } from 'vitest';
import { episodeToEditForm, formatEpisodeRuntime, syncResultText } from '../../lib/admin-format';

describe('admin formatting', () => {
  it('formats sync results and runtimes', () => {
    expect(formatEpisodeRuntime(1500)).toBe('25m');
    expect(syncResultText({ status: 'created', episodes_added: 1, item_type: 'series' })).toBe('Created - 1 episode');
  });

  it('converts episode records into controlled form values', () => {
    expect(episodeToEditForm({ id: 3, episode_number: 2, duration: 1200 }).runtime_minutes).toBe('20');
  });
});

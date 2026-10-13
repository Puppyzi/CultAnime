import { NextResponse } from 'next/server';
import { groupAnimeSeries, readAnimeSeriesRows, jsonList } from '../../../../lib/anime-series';
import { getDb } from '../../../../lib/db';
import { reconcileForRead } from '../../../../lib/library-reconciler';
import { getNextAiringEpisode } from '../../../../lib/anilist';
import { sanitizeEpisodesForPublic } from '../../../../lib/episode-overview-trust';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    await reconcileForRead();

    const db = getDb();
    const anime = db.prepare('SELECT * FROM anime WHERE id = ?').get(id);
    
    if (!anime) {
      return NextResponse.json({ error: 'Anime not found' }, { status: 404 });
    }

    const episodeRows = db.prepare('SELECT * FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC').all(id);
    const episodes = sanitizeEpisodesForPublic(episodeRows, anime);
    let nextAiringEpisode = null;

    if (anime.anilist_id && ['RELEASING', 'NOT_YET_RELEASED'].includes(String(anime.status || '').toUpperCase())) {
      try {
        nextAiringEpisode = await getNextAiringEpisode(anime.anilist_id);
      } catch (airingError) {
        console.warn(`Next airing lookup failed for anime ${anime.id}:`, airingError.message);
      }
    }

    let seasons;
    if (new URL(request.url).searchParams.get('include') === 'seasons') {
      const series = groupAnimeSeries(readAnimeSeriesRows(db)).find(item => item.season_ids.includes(anime.id));
      const readEpisodes = db.prepare('SELECT * FROM episodes WHERE anime_id = ? ORDER BY episode_number ASC');
      seasons = (series?.seasons || []).map(member => ({
        ...member,
        genres: jsonList(member.genres),
        studios: jsonList(member.studios),
        episodes: member.id === anime.id ? episodes : sanitizeEpisodesForPublic(readEpisodes.all(member.id), member),
      }));
    }

    return NextResponse.json({
      ...anime,
      ...(seasons ? { seasons } : {}),
      genres: JSON.parse(anime.genres || '[]'),
      studios: JSON.parse(anime.studios || '[]'),
      next_airing_episode: nextAiringEpisode,
      episodes,
    });
  } catch (error) {
    console.error('Anime detail error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

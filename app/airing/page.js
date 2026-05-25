import AiringClient from './AiringClient';
import { getAiringAnime } from '../../lib/anilist';
import { normalizeAiringSort, sortAiringGroups } from '../../lib/airingSort';

export const dynamic = 'force-dynamic';

export default async function AiringPage({ searchParams }) {
  const params = await searchParams;
  const sort = normalizeAiringSort(Array.isArray(params?.sort) ? params.sort[0] : params?.sort);

  try {
    const data = await getAiringAnime();

    return (
      <AiringClient
        key={sort}
        initialGroups={sortAiringGroups(data.groups, sort)}
        initialSeason={data.season}
        initialYear={data.year}
        initialSort={sort}
        initialError=""
      />
    );
  } catch (error) {
    return (
      <AiringClient
        key={sort}
        initialGroups={[]}
        initialSeason=""
        initialYear=""
        initialSort={sort}
        initialError={error.message || 'Could not load airing anime.'}
      />
    );
  }
}

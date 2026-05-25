import AiringClient from './AiringClient';
import { getAiringAnime } from '../../lib/anilist';

export const dynamic = 'force-dynamic';

export default async function AiringPage() {
  try {
    const data = await getAiringAnime();

    return (
      <AiringClient
        initialGroups={data.groups}
        initialSeason={data.season}
        initialYear={data.year}
        initialError=""
      />
    );
  } catch (error) {
    return (
      <AiringClient
        initialGroups={[]}
        initialSeason=""
        initialYear=""
        initialError={error.message || 'Could not load airing anime.'}
      />
    );
  }
}

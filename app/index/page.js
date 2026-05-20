import Link from 'next/link';
import { getDb } from '../../lib/db';
import { reconcileForRead } from '../../lib/library-reconciler';

export const dynamic = 'force-dynamic';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const INDEX_GROUPS = ['#', ...LETTERS];

function titleFor(anime) {
  return anime.title || anime.title_english || anime.title_romaji || 'Untitled';
}

function groupFor(title) {
  const first = title.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(first) ? first : '#';
}

function sectionId(letter) {
  return `index-${letter === '#' ? 'number' : letter}`;
}

function metaFor(anime) {
  const parts = [];
  const episodeTotal = anime.episode_count || anime.episodes_total;

  if (episodeTotal) parts.push(`${episodeTotal} EP`);
  if (anime.year) parts.push(String(anime.year));
  if (anime.rating) parts.push(`${anime.rating}%`);

  return parts.join(' / ');
}

function normalizeSelectedLetter(searchParams) {
  const rawLetter = Array.isArray(searchParams?.letter)
    ? searchParams.letter[0]
    : searchParams?.letter;
  if (!rawLetter) return null;

  const letter = String(rawLetter).trim().toUpperCase();
  return INDEX_GROUPS.includes(letter) ? letter : null;
}

function parseJsonList(value) {
  try {
    return JSON.parse(value || '[]');
  } catch {
    return [];
  }
}

async function loadAnime() {
  await reconcileForRead();

  const db = getDb();
  const rows = db.prepare('SELECT * FROM anime ORDER BY title COLLATE NOCASE ASC').all();
  const countEpisode = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE anime_id = ?');

  return rows.map(anime => ({
    ...anime,
    genres: parseJsonList(anime.genres),
    studios: parseJsonList(anime.studios),
    episode_count: countEpisode.get(anime.id)?.count || 0,
  }));
}

export default async function IndexPage({ searchParams }) {
  const params = await searchParams;
  const selectedLetter = normalizeSelectedLetter(params);
  const anime = await loadAnime();
  const grouped = Object.fromEntries(INDEX_GROUPS.map(letter => [letter, []]));

  anime.forEach(item => {
    grouped[groupFor(titleFor(item))].push(item);
  });

  const populatedGroups = INDEX_GROUPS.filter(letter => grouped[letter].length > 0);
  const visibleGroups = selectedLetter
    ? (grouped[selectedLetter].length > 0 ? [selectedLetter] : [])
    : populatedGroups;
  const visibleCount = selectedLetter ? grouped[selectedLetter].length : anime.length;

  return (
    <div className="index-page">
      <header className="index-header">
        <div>
          <p className="index-kicker">Library</p>
          <h1>Anime Index</h1>
        </div>
        <span className="index-count">{visibleCount} series</span>
      </header>

      <nav className="index-letters" aria-label="Anime index letters">
        <Link className={`index-all-link ${selectedLetter ? '' : 'active'}`} href="/index">
          All
        </Link>
        {INDEX_GROUPS.map(letter => grouped[letter]?.length > 0 ? (
          <Link
            key={letter}
            className={`index-letter-link ${selectedLetter === letter ? 'active' : ''}`}
            href={`/index?letter=${encodeURIComponent(letter)}`}
          >
            {letter}
          </Link>
        ) : (
          <span key={letter} className="index-letter-link disabled">
            {letter}
          </span>
        ))}
      </nav>

      {anime.length === 0 ? (
        <div className="empty-state">
          <div className="icon">A-Z</div>
          <h3>No anime yet</h3>
          <p>Your index will appear once the library has anime.</p>
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="empty-state">
          <div className="icon">{selectedLetter}</div>
          <h3>No anime under {selectedLetter}</h3>
          <p>Choose another letter or go back to All.</p>
        </div>
      ) : (
        <div className="index-sections">
          {visibleGroups.map(letter => (
            <section key={letter} id={sectionId(letter)} className="index-section">
              <h2 className="index-section-title">
                <span>{letter}</span>
                <small>{grouped[letter].length}</small>
              </h2>
              <div className="index-list">
                {grouped[letter].map(item => {
                  const title = titleFor(item);
                  const meta = metaFor(item);

                  return (
                    <Link key={item.id} className="index-item" href={`/anime/${item.id}`}>
                      <img className="index-item-cover" src={item.cover_image || '/placeholder.png'} alt={title} />
                      <div className="index-item-info">
                        <h3>{title}</h3>
                        {meta && <p>{meta}</p>}
                      </div>
                      <span className="index-item-arrow" aria-hidden="true">&gt;</span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

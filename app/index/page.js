'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

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

function normalizeSelectedLetter(value) {
  if (!value) return null;

  const letter = String(value).trim().toUpperCase();
  return INDEX_GROUPS.includes(letter) ? letter : null;
}

function IndexContent() {
  const searchParams = useSearchParams();
  const selectedLetter = normalizeSelectedLetter(searchParams.get('letter'));
  const [anime, setAnime] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let ignore = false;

    async function loadAnime() {
      setLoading(true);
      setError('');

      try {
        const res = await fetch('/api/index', { cache: 'no-store' });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Could not load anime index');
        }

        if (!ignore) {
          setAnime(data.anime || []);
        }
      } catch (loadError) {
        console.error(loadError);
        if (!ignore) {
          setAnime([]);
          setError(loadError.message || 'Could not load anime index');
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadAnime();

    return () => {
      ignore = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const groups = Object.fromEntries(INDEX_GROUPS.map(letter => [letter, []]));

    anime.forEach(item => {
      groups[groupFor(titleFor(item))].push(item);
    });

    return groups;
  }, [anime]);

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
        {!loading && !error && <span className="index-count">{visibleCount} series</span>}
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

      {loading ? (
        <div className="index-loading-list" aria-label="Loading anime index">
          {Array(6).fill(0).map((_, index) => (
            <div key={index} className="index-skeleton-item">
              <div className="skeleton index-skeleton-cover" />
              <div className="index-skeleton-copy">
                <div className="skeleton" />
                <div className="skeleton short" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="empty-state">
          <div className="icon">A-Z</div>
          <h3>Index could not load</h3>
          <p>{error}</p>
        </div>
      ) : anime.length === 0 ? (
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

export default function IndexPage() {
  return (
    <Suspense fallback={<div className="index-page">Loading...</div>}>
      <IndexContent />
    </Suspense>
  );
}

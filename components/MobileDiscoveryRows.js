'use client';

import Link from 'next/link';
import ScrollRow from './ScrollRow';
import { FilmIcon, FlameIcon, StarIcon } from './Icons';
import styles from './MobileDiscoveryRows.module.css';

function Poster({ anime }) {
  if (!anime.cover_image) {
    return (
      <span className={styles.posterPlaceholder} aria-hidden="true">
        <FilmIcon />
      </span>
    );
  }

  // The adjacent title already names the link, so the artwork stays decorative
  // to avoid repeating the anime title for screen-reader users.
  return (
    <img
      className={styles.poster}
      src={anime.cover_image}
      alt=""
      loading="lazy"
      decoding="async"
    />
  );
}

function metadataFor(anime) {
  return [
    anime.episodes_total ? `${anime.episodes_total} EP` : null,
    anime.year || null,
  ].filter(Boolean).join(' · ');
}

function DiscoveryCard({ anime, rank }) {
  const metadata = metadataFor(anime);
  const isRanked = typeof rank === 'number';

  return (
    <Link
      href={`/anime/${anime.id}`}
      className={`${styles.card} ${isRanked ? styles.rankedCard : styles.recentCard}`}
    >
      {isRanked && (
        <span className={`${styles.rank} ${rank <= 3 ? styles.topRank : ''}`} aria-hidden="true">
          {String(rank).padStart(2, '0')}
        </span>
      )}
      <Poster anime={anime} />
      <span className={styles.cardBody}>
        <span className={styles.cardTitle}>{anime.title}</span>
        {metadata && <span className={styles.meta}>{metadata}</span>}
        {anime.rating && (
          <span className={styles.rating}>
            <StarIcon /> {anime.rating}%
          </span>
        )}
      </span>
    </Link>
  );
}

function DiscoverySection({ icon, title, items, ranked = false }) {
  if (items.length === 0) return null;

  const headingId = `mobile-discovery-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden="true">{icon}</span>
        <h2 id={headingId}>{title}</h2>
      </div>
      <ScrollRow className={styles.row}>
        {items.map((anime, index) => (
          <DiscoveryCard
            key={anime.id}
            anime={anime}
            rank={ranked ? index + 1 : undefined}
          />
        ))}
      </ScrollRow>
    </section>
  );
}

/**
 * Reintroduces the desktop sidebar's discovery lists as touch-friendly rails
 * when the sidebar is intentionally hidden at tablet and mobile widths.
 */
export default function MobileDiscoveryRows({ recentlyAdded = [], popular = [] }) {
  if (recentlyAdded.length === 0 && popular.length === 0) return null;

  return (
    <div className={styles.mobileDiscovery}>
      <DiscoverySection
        icon={<FilmIcon />}
        title="Recently Added"
        items={recentlyAdded}
      />
      <DiscoverySection
        icon={<FlameIcon />}
        title="Top Anime"
        items={popular}
        ranked
      />
    </div>
  );
}

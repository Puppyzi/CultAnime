'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { CloseIcon, MenuIcon, SearchIcon } from './Icons';
import { fetchJson } from '../lib/client-api';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeResult, setActiveResult] = useState(-1);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navRef = useRef(null);
  const menuButtonRef = useRef(null);
  const firstNavLinkRef = useRef(null);
  const shouldFocusFirstNavLinkRef = useRef(false);
  const searchRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
      if (navRef.current && !navRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        const menuWasOpen = navRef.current?.querySelector('.navbar-links.is-open');
        setShowDropdown(false);
        setIsMenuOpen(false);
        if (menuWasOpen) menuButtonRef.current?.focus();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (isMenuOpen && shouldFocusFirstNavLinkRef.current) {
      firstNavLinkRef.current?.focus();
    }
    shouldFocusFirstNavLinkRef.current = false;
  }, [isMenuOpen]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      setShowDropdown(false);
      setSearchLoading(false);
      setSearchError('');
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError('');
    setActiveResult(-1);
    setShowDropdown(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await fetchJson(`/api/search?q=${encodeURIComponent(trimmedQuery)}`, { signal: controller.signal });
        setResults(data.anime || []);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setResults([]);
          setSearchError(error.message);
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function openResult(result) {
    if (!result) return;
    setShowDropdown(false);
    setQuery('');
    router.push(`/anime/${result.id}`);
  }

  function handleSearchKeyDown(event) {
    if (!showDropdown) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResult(current => Math.min(results.length - 1, current + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult(current => Math.max(-1, current - 1));
    } else if (event.key === 'Enter' && activeResult >= 0) {
      event.preventDefault();
      openResult(results[activeResult]);
    }
  }

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/airing', label: 'Airing' },
    { href: '/browse', label: 'Browse' },
    { href: '/anime-index', label: 'Index', reload: true },
    { href: '/request', label: 'Request', reload: true },
    { href: '/watchlist', label: 'Watchlist' },
    { href: '/admin', label: 'Admin' },
  ];
  const isActive = (link) => {
    if (link.href === '/anime-index') {
      return pathname === '/anime-index' || pathname === '/index';
    }
    return pathname === link.href;
  };

  return (
    <nav className="navbar" ref={navRef}>
      <Link href="/" className="navbar-logo">
        <span>cult</span><span className="navbar-logo-anime">Anime</span>
      </Link>
      <div
        id="navbar-main-links"
        className={`navbar-links${isMenuOpen ? ' is-open' : ''}`}
        aria-label="Primary navigation"
      >
        {navLinks.map(l => (
          l.reload ? (
            <a
              key={l.href}
              href={l.href}
              className={isActive(l) ? 'active' : ''}
              aria-current={isActive(l) ? 'page' : undefined}
              onClick={() => setIsMenuOpen(false)}
            >
              {l.label}
            </a>
          ) : (
            <Link
              key={l.href}
              ref={l.href === '/' ? firstNavLinkRef : undefined}
              href={l.href}
              className={isActive(l) ? 'active' : ''}
              aria-current={isActive(l) ? 'page' : undefined}
              onClick={() => setIsMenuOpen(false)}
            >
              {l.label}
            </Link>
          )
        ))}
      </div>
      <div className="navbar-search" ref={searchRef}>
        <span className="search-icon"><SearchIcon /></span>
        <input
          type="search" placeholder="Search anime..." aria-label="Search anime"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="navbar-search-results"
          aria-expanded={showDropdown}
          aria-activedescendant={activeResult >= 0 ? `navbar-search-result-${results[activeResult]?.id}` : undefined}
          value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => {
            setIsMenuOpen(false);
            if (results.length > 0) setShowDropdown(true);
          }}
        />
        {showDropdown && (
          <div id="navbar-search-results" className="search-dropdown" role="listbox" aria-label="Anime search results">
            {searchLoading && <p className="search-dropdown-status">Searching…</p>}
            {!searchLoading && searchError && <p className="search-dropdown-status search-dropdown-error">Search is unavailable. Try again.</p>}
            {!searchLoading && !searchError && results.length === 0 && <p className="search-dropdown-status">No anime found.</p>}
            {results.map(a => (
              <Link
                key={a.id}
                id={`navbar-search-result-${a.id}`}
                href={`/anime/${a.id}`}
                role="option"
                aria-selected={results[activeResult]?.id === a.id}
                className={`search-result${results[activeResult]?.id === a.id ? ' active' : ''}`}
                onMouseEnter={() => setActiveResult(results.indexOf(a))}
                onClick={() => { setShowDropdown(false); setQuery(''); }}
              >
                {a.cover_image && <img src={a.cover_image} alt={a.title} />}
                <div className="search-result-info">
                  <h4>{a.title}</h4>
                  <p>{a.episodes_total ? `${a.episodes_total} eps` : ''} {a.year ? `• ${a.year}` : ''}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <button
        ref={menuButtonRef}
        className="navbar-menu-toggle"
        type="button"
        aria-controls="navbar-main-links"
        aria-expanded={isMenuOpen}
        aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={(event) => {
          setShowDropdown(false);
          const openedWithKeyboard = event.detail === 0;
          setIsMenuOpen(current => {
            const next = !current;
            shouldFocusFirstNavLinkRef.current = next && openedWithKeyboard;
            return next;
          });
        }}
      >
        {isMenuOpen ? <CloseIcon /> : <MenuIcon />}
      </button>
    </nav>
  );
}

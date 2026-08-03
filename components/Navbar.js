'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CloseIcon, MenuIcon, SearchIcon } from './Icons';

export default function Navbar() {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const navRef = useRef(null);
  const menuButtonRef = useRef(null);
  const firstNavLinkRef = useRef(null);
  const shouldFocusFirstNavLinkRef = useRef(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

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
    if (!query.trim()) { setResults([]); setShowDropdown(false); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.anime || []);
        setShowDropdown(true);
      } catch (e) { console.error(e); }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

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
          type="text" placeholder="Search anime..." aria-label="Search anime"
          value={query} onChange={e => setQuery(e.target.value)}
          onFocus={() => {
            setIsMenuOpen(false);
            if (results.length > 0) setShowDropdown(true);
          }}
        />
        {showDropdown && results.length > 0 && (
          <div className="search-dropdown">
            {results.map(a => (
              <Link
                key={a.id}
                href={`/anime/${a.id}`}
                className="search-result"
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

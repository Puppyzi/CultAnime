'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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
  }, [query]);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/browse', label: 'Browse' },
    { href: '/index', label: 'Index', reload: true },
    { href: '/watchlist', label: 'Watchlist' },
    { href: '/admin', label: 'Admin' },
  ];

  return (
    <nav className="navbar">
      <Link href="/" className="navbar-logo">
        <span>cult</span><span className="navbar-logo-anime">Anime</span>
      </Link>
      <div className="navbar-links">
        {navLinks.map(l => (
          l.reload ? (
            <a key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''}>
              {l.label}
            </a>
          ) : (
            <Link key={l.href} href={l.href}
              className={pathname === l.href ? 'active' : ''}>
              {l.label}
            </Link>
          )
        ))}
      </div>
      <span>1.2</span>
      <div className="navbar-search" ref={searchRef}>
        <span className="search-icon">🔍</span>
        <input
          type="text" placeholder="Search anime..."
          value={query} onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
        />
        {showDropdown && results.length > 0 && (
          <div className="search-dropdown">
            {results.map(a => (
              <div key={a.id} className="search-result"
                onClick={() => { router.push(`/anime/${a.id}`); setShowDropdown(false); setQuery(''); }}>
                {a.cover_image && <img src={a.cover_image} alt={a.title} />}
                <div className="search-result-info">
                  <h4>{a.title}</h4>
                  <p>{a.episodes_total ? `${a.episodes_total} eps` : ''} {a.year ? `• ${a.year}` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

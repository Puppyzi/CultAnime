import Link from 'next/link';

export default function NotFound() {
  return <div className="empty-state" style={{ paddingTop: '8rem' }}><h1>Page not found</h1><p>The page may have moved or the anime is no longer in the library.</p><Link className="btn btn-primary" href="/">Back Home</Link></div>;
}

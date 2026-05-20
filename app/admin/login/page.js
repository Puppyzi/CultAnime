'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

function safeNextPath(value) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/admin';
  if (value.startsWith('/admin/login')) return '/admin';
  return value;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [nextPath, setNextPath] = useState('/admin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNextPath(safeNextPath(params.get('next')));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || 'Login failed.');
      }

      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setError(err.message || 'Login failed.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login-page">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <div className="admin-login-kicker">Admin Access</div>
        <h1>Sign in to CultAnime</h1>
        <div className="form-group">
          <label>Admin Password</label>
          <input
            className="form-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
        </div>
        {error && <div className="admin-login-error">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

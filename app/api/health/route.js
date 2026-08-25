import { NextResponse } from 'next/server';
import { getDb } from '../../../lib/db';
import { checkServerHealth } from '../../../lib/jellyfin';
import { getSeerrConfig, seerrFetch } from '../../../lib/seerr';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const components = { database: 'unavailable', jellyfin: 'not_checked', seerr: 'not_checked' };
  try {
    getDb().prepare('SELECT 1').get();
    components.database = 'available';
  } catch {
    return NextResponse.json({ status: 'unhealthy', components }, { status: 503 });
  }

  const deep = new URL(request.url).searchParams.get('deep') === '1';
  if (deep) {
    const jellyfinConfigured = Boolean(process.env.JELLYFIN_URL && process.env.JELLYFIN_API_KEY);
    const seerrConfig = getSeerrConfig();
    components.jellyfin = jellyfinConfigured ? ((await checkServerHealth()) ? 'available' : 'unavailable') : 'not_configured';
    if (seerrConfig.configured) {
      try {
        await seerrFetch('/api/v1/status', { timeoutMs: 3000 });
        components.seerr = 'available';
      } catch {
        components.seerr = 'unavailable';
      }
    } else {
      components.seerr = 'not_configured';
    }
  }

  const degraded = Object.values(components).includes('unavailable');
  return NextResponse.json({ status: degraded ? 'degraded' : 'ok', components });
}

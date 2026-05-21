import { NextResponse } from 'next/server';
import { getSeerrConfig } from '../../../../lib/seerr';

export const dynamic = 'force-dynamic';

export async function GET() {
  const config = getSeerrConfig();

  return NextResponse.json({
    configured: config.configured,
    missing: config.missing,
  });
}

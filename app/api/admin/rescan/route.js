import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { enqueueRescanJob, getRescanJobs } from '../../../../lib/rescan-jobs';
import { ensureMediaWatcher, getMediaWatcherStatus, queueMediaChange } from '../../../../lib/media-watcher';

export async function GET() {
  try {
    ensureMediaWatcher();
    return NextResponse.json({
      watcher: getMediaWatcherStatus(),
      jobs: getRescanJobs(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    ensureMediaWatcher();
    const body = await request.json().catch(() => ({}));
    const updateType = body.updateType || 'Modified';

    if (body.local_path) {
      return NextResponse.json({
        watcher: queueMediaChange(body.local_path, updateType),
        jobs: getRescanJobs(),
      });
    }

    const paths = body.path ? [body.path] : (body.paths || []);
    const job = enqueueRescanJob({
      reason: body.reason || 'manual',
      paths,
      updates: body.updates || [],
      updateType,
      fullRefresh: Boolean(body.fullRefresh),
      syncAfter: body.syncAfter !== false,
    });

    return NextResponse.json({
      job,
      watcher: getMediaWatcherStatus(),
      jobs: getRescanJobs(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

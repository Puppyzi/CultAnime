import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { enqueueRescanJob, getRescanJobs } from '../../../../lib/rescan-jobs';
import { ensureMediaWatcher, getMediaWatcherStatus, queueMediaChange } from '../../../../lib/media-watcher';
import { ensureLibraryReconciler, getLibraryReconcilerStatus, queueLibraryReconcile } from '../../../../lib/library-reconciler';

export async function GET() {
  try {
    ensureMediaWatcher();
    ensureLibraryReconciler();
    return NextResponse.json({
      watcher: getMediaWatcherStatus(),
      reconciler: getLibraryReconcilerStatus(),
      jobs: getRescanJobs(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    ensureMediaWatcher();
    ensureLibraryReconciler();
    const body = await request.json().catch(() => ({}));
    const updateType = body.updateType || 'Modified';

    if (body.reconcile) {
      return NextResponse.json({
        reconcile: await queueLibraryReconcile({
          reason: body.reason || 'manual-reconcile',
          force: body.force !== false,
          minIntervalMs: 0,
        }),
        watcher: getMediaWatcherStatus(),
        reconciler: getLibraryReconcilerStatus(),
        jobs: getRescanJobs(),
      });
    }

    if (body.local_path) {
      return NextResponse.json({
        watcher: queueMediaChange(body.local_path, updateType),
        reconciler: getLibraryReconcilerStatus(),
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
      reconciler: getLibraryReconcilerStatus(),
      jobs: getRescanJobs(),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

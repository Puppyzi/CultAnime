export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureMediaWatcher } = await import('./lib/media-watcher');
    const { ensureLibraryReconciler } = await import('./lib/library-reconciler');
    ensureMediaWatcher();
    ensureLibraryReconciler();
  }
}

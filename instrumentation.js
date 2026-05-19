export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensureMediaWatcher } = await import('./lib/media-watcher');
    ensureMediaWatcher();
  }
}

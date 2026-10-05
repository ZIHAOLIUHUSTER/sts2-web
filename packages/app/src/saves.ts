import { G } from './game';

/** Save metadata without replacing the run's room-entry checkpoint. */
export function saveMetadata() {
  const sm = G.SaveManager.Instance;
  for (const save of ['SaveSettings', 'SavePrefsFile', 'SaveProgressFile', 'SaveProfile']) sm[save]();
}

/** Hold one writer per origin for this page's lifetime. Closing/reloading releases the browser lock. */
export async function acquireSaveLock(): Promise<boolean> {
  if (!navigator.locks) return true;
  return new Promise<boolean>((resolve, reject) => {
    void navigator.locks.request('sts2-save-writer', { ifAvailable: true }, lock => {
      resolve(!!lock);
      return lock ? new Promise<void>(() => {}) : undefined;
    }).catch(reject);
  });
}

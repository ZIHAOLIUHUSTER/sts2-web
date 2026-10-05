import { G, $ } from './game';
import { appText, loc } from './i18n';
import { ui, invalidate } from './store';
import { confirmPopup } from './ui/modal';

/** Save metadata without replacing the run's room-entry checkpoint. */
export function saveMetadata() {
  if ($.vfs.restored) return;
  const sm = G.SaveManager.Instance;
  for (const save of ['SaveSettings', 'SavePrefsFile', 'SaveProgressFile', 'SaveProfile']) sm[save]();
}
const notice = (key: string) => { ui.toast = appText(key); invalidate(); };
let busy = false;
async function downloadBackup() {
  // A full/broken browser store must not prevent downloading the last readable checkpoint.
  try { await G.SaveManager.Instance.CurrentRunSaveTask; saveMetadata(); } catch (e) { console.warn('Exporting previous saves', e); }
  try { await $.vfs.flush(); } catch (e) { console.warn('Exporting previous saves', e); }
  const files = $.vfs.list('user://').filter((p: string) => !p.endsWith('.tmp')).sort().map((p: string) => [p, $.vfs.read(p)!] as [string, string]);
  const text = await G.encodeBackup(files);
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `sts2-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function exportSaves() {
  if (busy) return;
  busy = true;
  try { await downloadBackup(); notice('backupExported'); }
  catch (e) { console.error(e); notice('backupFailed'); }
  finally { busy = false; }
}
export function importSaves() {
  if (busy) return;
  if ($.vfs.backend !== 'indexeddb' || !navigator.locks) { notice('restoreUnavailable'); return; }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file || busy) return;
    busy = true;
    try {
      const files = await G.decodeBackup(await file.text());
      // Download the current state before the destructive confirmation, then require explicit acknowledgement.
      await downloadBackup();
      const yes = await confirmPopup({ header: appText('restoreSaves'), body: appText('restoreBody'), yes: appText('restoreButton'), no: loc('main_menu_ui', 'GENERIC_POPUP.cancel') });
      if (!yes) return;
      await $.vfs.restore(files);
      location.reload();
    } catch (e) { console.error(e); notice('backupFailed'); }
    finally { busy = false; }
  };
  input.click();
}
export async function protectStorage() {
  try {
    const granted = await navigator.storage?.persist?.();
    await confirmPopup({ header: appText('protectStorage'), body: appText(granted ? 'storageProtected' : 'storageNotProtected'), yes: loc('main_menu_ui', 'GENERIC_POPUP.confirm') });
  } catch { notice('storageNotProtected'); }
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

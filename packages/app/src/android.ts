let exportingDocument = false;
/** Save through Android's document picker, with completion/cancellation reported by the native shell. */
export function exportAndroidBackup(filename: string, text: string): Promise<void> | null {
  const bridge = (window as Window & { Sts2Android?: { exportBackup(name: string, data: string): void } }).Sts2Android;
  if (!bridge) return null;
  if (exportingDocument) return Promise.reject(new Error("A document export is already in progress"));
  exportingDocument = true;
  return new Promise((resolve, reject) => {
    const done = (event: Event) => {
      exportingDocument = false;
      window.removeEventListener('sts2-backup-result', done);
      const error = (event as CustomEvent<string>).detail;
      if (!error) resolve();
      else reject(error === 'cancelled' ? new DOMException('Backup cancelled', 'AbortError') : new Error(error));
    };
    window.addEventListener('sts2-backup-result', done);
    try { bridge.exportBackup(filename, text); }
    catch (error) { exportingDocument = false; window.removeEventListener('sts2-backup-result', done); reject(error); }
  });
}

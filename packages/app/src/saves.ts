import { G } from './game';

/** Save metadata without replacing the run's room-entry checkpoint. */
export function saveMetadata() {
  const sm = G.SaveManager.Instance;
  for (const save of ['SaveSettings', 'SavePrefsFile', 'SaveProgressFile', 'SaveProfile']) sm[save]();
}

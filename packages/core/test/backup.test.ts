import { describe, expect, it } from 'vitest';
import { encodeBackup, decodeBackup } from '../src/backup';

describe('portable save backup', () => {
  const files: [string, string][] = [['user://profile.save', '{ "unknown_future_field": [1, 2] }'], ['user://1/saves/current_run.save.backup', '{"old":true}']];
  it('preserves original paths and exact bytes, including unknown fields and backups', async () => {
    expect(await decodeBackup(await encodeBackup(files))).toEqual(files);
  });
  it('rejects damaged content before any restore can start', async () => {
    const backup = JSON.parse(await encodeBackup(files));
    backup.files[0].content = '{}';
    await expect(decodeBackup(JSON.stringify(backup))).rejects.toThrow();
  });
  it('rejects duplicate paths, invalid paths and unsupported formats', async () => {
    const backup = JSON.parse(await encodeBackup(files));
    backup.files.push(backup.files[0]);
    await expect(decodeBackup(JSON.stringify(backup))).rejects.toThrow();
    await expect(encodeBackup([['user://../settings.save', '{}']])).rejects.toThrow();
    await expect(decodeBackup('{"format":"other","version":1,"files":[]}')).rejects.toThrow();
  });
});

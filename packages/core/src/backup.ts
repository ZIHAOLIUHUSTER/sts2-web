/** Portable envelope only. The game files inside stay byte-for-byte unchanged. */
type SaveFile = [string, string];
const FORMAT = 'sts2-web-backup';
const validPath = (path: string) => path.startsWith('user://') && path.length > 7 && !path.slice(7).split('/').some(p => !p || p === '.' || p === '..') && !/[\\\u0000-\u001f]/.test(path);
const digest = async (content: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), b => b.toString(16).padStart(2, '0')).join('');

export async function encodeBackup(files: SaveFile[]): Promise<string> {
  const seen = new Set<string>();
  return JSON.stringify({ format: FORMAT, version: 1, createdAt: new Date().toISOString(), files: await Promise.all(files.map(async ([path, content]) => {
    if (!validPath(path) || seen.has(path)) throw new Error('Invalid save path');
    seen.add(path);
    return { path, content, sha256: await digest(content) };
  })) }, null, 2);
}

export async function decodeBackup(text: string): Promise<SaveFile[]> {
  const data = JSON.parse(text);
  if (data?.format !== FORMAT || data.version !== 1 || !Array.isArray(data.files) || !data.files.length) throw new Error('Invalid backup format');
  const seen = new Set<string>();
  const files: SaveFile[] = [];
  for (const file of data.files) {
    if (typeof file?.path !== 'string' || !validPath(file.path) || seen.has(file.path) || typeof file.content !== 'string' || file.sha256 !== await digest(file.content)) throw new Error('Invalid or damaged backup');
    seen.add(file.path);
    files.push([file.path, file.content]);
  }
  return files;
}

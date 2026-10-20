// Where screenshots come from and where they go.
//
//  - "folder": File System Access API (Chrome, Edge). Files are moved in place,
//    and every move is logged to .screenshot-sloth-undo.json so it can be undone.
//  - "files": any browser. Nothing is touched; you get a sorted .zip instead.
//  - "demo": synthetic screenshots generated in the page.
import { zipSync } from 'fflate';

export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
export const UNDO_FILE = '.screenshot-sloth-undo.json';

export interface Shot { id: string; file: File; name: string; handle?: FileSystemFileHandle }
export interface Source { kind: 'folder' | 'files' | 'demo'; label: string; shots: Shot[]; dir?: FileSystemDirectoryHandle }
export interface Move { from: string; folder: string; to: string }
export interface UndoLog { app: 'screenshot-sloth'; at: string; moves: Move[] }

// Not in TypeScript's DOM lib yet.
type DirWithIter = FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
type MovableFile = FileSystemFileHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> };

export const canPickFolder = () => 'showDirectoryPicker' in window;

export async function pickFolder(): Promise<Source> {
  return listFolder(await (window as any).showDirectoryPicker({ id: 'screenshot-sloth', mode: 'readwrite', startIn: 'pictures' }));
}

/** Top-level images only: anything already in a subfolder counts as sorted. */
export async function listFolder(dir: FileSystemDirectoryHandle): Promise<Source> {
  const shots: Shot[] = [];
  for await (const h of (dir as DirWithIter).values()) {
    if (h.kind !== 'file' || !IMAGE_EXT.test(h.name)) continue;
    const handle = h as FileSystemFileHandle;
    shots.push({ id: crypto.randomUUID(), file: await handle.getFile(), name: h.name, handle });
  }
  shots.sort((a, b) => a.file.lastModified - b.file.lastModified);
  return { kind: 'folder', label: dir.name, shots, dir };
}

export function fromFiles(list: FileList | File[]): Source {
  const shots = [...list].filter(f => IMAGE_EXT.test(f.name)).map(file => ({ id: crypto.randomUUID(), file, name: file.name }));
  return { kind: 'files', label: `${shots.length} files`, shots };
}

async function exists(dir: FileSystemDirectoryHandle, name: string) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

async function freeName(dir: FileSystemDirectoryHandle, name: string) {
  if (!(await exists(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  for (let i = 2; ; i++) {
    const n = `${name.slice(0, dot)}-${i}${name.slice(dot)}`;
    if (!(await exists(dir, n))) return n;
  }
}

/** Move one file. Uses the native move() where the browser has it; otherwise copy, verify, then remove. */
async function moveFile(src: FileSystemDirectoryHandle, handle: FileSystemFileHandle, dest: FileSystemDirectoryHandle, name: string) {
  const h = handle as MovableFile;
  if (typeof h.move === 'function') return h.move(dest, name);
  const file = await handle.getFile();
  const out = await dest.getFileHandle(name, { create: true });
  const w = await out.createWritable();
  await w.write(file);
  await w.close();
  if ((await out.getFile()).size !== file.size) throw new Error(`Copy of ${handle.name} came out the wrong size; original kept.`);
  await src.removeEntry(handle.name);
}

export async function applyMoves(
  root: FileSystemDirectoryHandle, shots: Map<string, Shot>,
  plan: { id: string; folder: string; to: string }[],
  onStep: (done: number) => void,
): Promise<UndoLog> {
  const moves: Move[] = [];
  const log: UndoLog = { app: 'screenshot-sloth', at: new Date().toISOString(), moves };
  try {
    for (const [i, p] of plan.entries()) {
      const shot = shots.get(p.id)!;
      const dest = await root.getDirectoryHandle(p.folder, { create: true });
      const to = await freeName(dest, p.to);
      await moveFile(root, shot.handle!, dest, to);
      moves.push({ from: shot.name, folder: p.folder, to });
      onStep(i + 1);
    }
  } finally {
    // Even a half-finished run gets a log, so whatever did move can be put back.
    await writeLog(root, log);
  }
  return log;
}

export async function undoMoves(root: FileSystemDirectoryHandle, log: UndoLog, onStep: (done: number) => void) {
  for (const [i, m] of [...log.moves].reverse().entries()) {
    const dir = await root.getDirectoryHandle(m.folder);
    const handle = await dir.getFileHandle(m.to);
    await moveFile(dir, handle, root, await freeName(root, m.from));
    onStep(i + 1);
  }
  // Remove folders we created, but only if they're empty now (non-recursive remove fails otherwise).
  for (const folder of new Set(log.moves.map(m => m.folder))) {
    try { await root.removeEntry(folder); } catch { /* not empty: something else lives there */ }
  }
  try { await root.removeEntry(UNDO_FILE); } catch { /* already gone */ }
}

async function writeLog(root: FileSystemDirectoryHandle, log: UndoLog) {
  const h = await root.getFileHandle(UNDO_FILE, { create: true });
  const w = await h.createWritable();
  await w.write(JSON.stringify(log, null, 2));
  await w.close();
}

export async function readLog(root: FileSystemDirectoryHandle): Promise<UndoLog | null> {
  try {
    const log = JSON.parse(await (await (await root.getFileHandle(UNDO_FILE)).getFile()).text());
    return log?.app === 'screenshot-sloth' && Array.isArray(log.moves) ? log : null;
  } catch { return null; }
}

/** For browsers without folder access, and for the demo: the sorted result as a zip. Originals untouched. */
export async function zipPlan(shots: Map<string, Shot>, plan: { id: string; folder: string; to: string }[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const p of plan) {
    let path = `${p.folder}/${p.to}`;
    for (let i = 2; path in entries; i++) path = `${p.folder}/${p.to.replace(/(\.\w+)?$/, `-${i}$1`)}`;
    entries[path] = new Uint8Array(await shots.get(p.id)!.file.arrayBuffer());
  }
  // Images are already compressed; level 0 keeps this fast.
  return new Blob([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

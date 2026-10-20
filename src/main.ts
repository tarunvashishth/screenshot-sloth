import './style.css';
import {
  planFor, findDuplicates, wordsOf, looksUnnamed, KIND_LABEL, FOLDERS, REVIEW_FOLDER, DUPLICATES_FOLDER,
  type Analysis, type Hashed, type PlanItem,
} from './rules.ts';
import { tiles, thumb, gray32 } from './image.ts';
import {
  canPickFolder, pickFolder, listFolder, fromFiles, applyMoves, undoMoves, readLog, zipPlan,
  type Source, type Shot, type UndoLog,
} from './fs.ts';
import { demoSource } from './demo.ts';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// Rough cost of doing one by hand: open it, read it, think of a name, type it, drag it.
const SECONDS_BY_HAND = 10;

// ---------------------------------------------------------------- worker

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let device = '';
let modelReady = false;

worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'progress') {
    // Loading from the browser cache reports progress too, so don't claim it's downloading.
    if (m.total < 20e6) { setStatus('Loading the model…'); return; }
    const pct = Math.round((m.loaded / m.total) * 100);
    setStatus(`Loading the model (${Math.round(m.total / 1e6)} MB, downloaded once then cached): ${pct}%`);
    setMeter(m.loaded / m.total);
  } else if (m.type === 'ready') {
    device = m.device; modelReady = true;
    if (busy) { startedAt = performance.now(); setStatus(`Model ready on ${device}. Reading…`); }
  } else if (m.type === 'result') {
    pending.get(m.id)?.resolve(m); pending.delete(m.id);
  } else if (m.type === 'error') {
    if (m.id && pending.has(m.id)) { pending.get(m.id)!.reject(new Error(m.message)); pending.delete(m.id); }
    else setStatus(`The model failed to load: ${m.message}`);
  }
};

function analyzeOnWorker(id: string, file: File): Promise<{ lines: Analysis['lines']; caption: string; ms: number; gray: Uint8Array; aspect: number; height: number }> {
  return createImageBitmap(file).then(bmp => new Promise((resolve, reject) => {
    const t = tiles(bmp), th = thumb(bmp);
    const gray = gray32(bmp);
    const aspect = bmp.width / bmp.height, height = bmp.height;
    bmp.close();
    pending.set(id, { resolve: r => resolve({ ...r, gray, aspect, height }), reject });
    worker.postMessage({ type: 'analyze', id, tiles: t, thumb: th, height }, [...t.map(x => x.data.buffer), th.data.buffer]);
  }));
}

// ---------------------------------------------------------------- state

let source: Source | null = null;
let shots = new Map<string, Shot>();
const analyses = new Map<string, Analysis>();
const hashes = new Map<string, Hashed>();
const failed = new Map<string, string>();
const thumbs = new Map<string, string>();
const excluded = new Set<string>();
const renamed = new Map<string, string>();
let plan: PlanItem[] = [];
let busy = false, done = false, applied: UndoLog | null = null;
let startedAt = 0, finishedAt = 0, runId = 0;

// Dev only: lets the console inspect what the model read.
if (import.meta.env.DEV) (window as any).__sloth = { analyses, hashes, plan: () => plan };

function setStatus(s: string) { $('#status').textContent = s; }
function setMeter(f: number) { $('#meter-fill').style.width = `${Math.max(0, Math.min(1, f)) * 100}%`; }

function recompute() {
  const dupOf = findDuplicates([...hashes.values()]);
  const taken = new Set<string>();
  plan = [];
  for (const shot of source!.shots) {
    const a = analyses.get(shot.id);
    if (!a) continue;
    const item = planFor(a, dupOf.get(shot.id) ?? null, taken, !looksUnnamed(shot.name));
    if (renamed.has(item.id)) item.to = renamed.get(item.id)!;
    item.include = !excluded.has(item.id);
    plan.push(item);
  }
}

// ---------------------------------------------------------------- rendering

const FOLDER_ORDER = [REVIEW_FOLDER, DUPLICATES_FOLDER, ...Object.values(FOLDERS)];
const FOLDER_NOTE: Record<string, string> = {
  [REVIEW_FOLDER]: 'These hold something you probably shouldn\'t keep in a screenshot. Kept together so you can look once and delete.',
  [DUPLICATES_FOLDER]: 'Near-identical copies. The sharpest copy of each stays in its folder; these are the extras.',
};

function render() {
  const groups = new Map<string, PlanItem[]>();
  for (const p of plan) groups.set(p.folder, [...(groups.get(p.folder) ?? []), p]);
  const pendingShots = source!.shots.filter(s => !analyses.has(s.id) && !failed.has(s.id));
  const nameOf = (id: string) => shots.get(id)?.name ?? '';

  let html = '';
  for (const folder of FOLDER_ORDER) {
    const items = groups.get(folder);
    if (!items) continue;
    const special = folder === REVIEW_FOLDER ? 'review' : folder === DUPLICATES_FOLDER ? 'dup' : '';
    html += `<section class="folder ${special}"><h3><span class="folder-icon" aria-hidden="true">📁</span>${esc(folder)} <span class="count">${items.length}</span></h3>`;
    if (FOLDER_NOTE[folder]) html += `<p class="folder-note">${FOLDER_NOTE[folder]}</p>`;
    html += '<ul>';
    for (const p of items) {
      const tags = [
        ...p.findings.map(f => `<span class="chip warn" title="${esc(KIND_LABEL[f.kind])}">${esc(KIND_LABEL[f.kind])} ${esc(f.masked)}</span>`),
        p.duplicateOf ? `<span class="chip dup">copy of ${esc(nameOf(p.duplicateOf))}</span>` : '',
        special ? `<span class="chip">${p.category}</span>` : '',
        p.from === p.to ? '<span class="chip">name kept</span>' : '',
      ].join('');
      html += `<li class="row${p.include ? '' : ' off'}" data-id="${p.id}">
        <img class="thumb" src="${thumbs.get(p.id)}" alt="" loading="lazy" />
        <div class="names">
          <span class="from" title="${esc(p.from)}">${esc(p.from)}</span>
          <input class="to" value="${esc(p.to)}" aria-label="New name for ${esc(p.from)}" ${done && !applied ? '' : 'readonly'} spellcheck="false" />
          <div class="tags">${tags}</div>
        </div>
        <label class="include" title="Include this file"><input type="checkbox" ${p.include ? 'checked' : ''} ${done && !applied ? '' : 'disabled'} /><span class="sr">Include</span></label>
      </li>`;
    }
    html += '</ul></section>';
  }
  if (failed.size) {
    html += `<section class="folder"><h3>Couldn't read <span class="count">${failed.size}</span></h3><ul>`;
    for (const [id, why] of failed) html += `<li class="row off"><div class="names"><span class="from">${esc(nameOf(id))}</span><span class="why">${esc(why)}</span></div></li>`;
    html += '</ul></section>';
  }
  if (pendingShots.length) {
    html += `<section class="folder waiting"><h3>Still to read <span class="count">${pendingShots.length}</span></h3><ul class="mini">`;
    for (const s of pendingShots.slice(0, 40)) html += `<li><img class="thumb" src="${thumbs.get(s.id)}" alt="" loading="lazy" /></li>`;
    html += '</ul></section>';
  }
  $('#plan').innerHTML = html;
  updateApply();
}

function updateApply() {
  const btn = $<HTMLButtonElement>('#apply');
  const n = plan.filter(p => p.include).length;
  if (applied) {
    btn.disabled = false;
    btn.textContent = 'Undo';
    return;
  }
  btn.disabled = !done || n === 0;
  btn.textContent = source?.kind === 'folder' ? `Move ${n} file${n === 1 ? '' : 's'}` : `Download ${n} sorted as .zip`;
}

const fmtTime = (ms: number) => ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;

function renderPayoff() {
  const n = analyses.size;
  const took = finishedAt - startedAt;
  const byHand = n * SECONDS_BY_HAND * 1000;
  const folders = new Set(plan.map(p => p.folder)).size;
  const flagged = plan.filter(p => p.findings.length).length;
  const dups = plan.filter(p => p.duplicateOf).length;
  const el = $('#payoff');
  el.hidden = false;
  el.innerHTML = `
    <p class="big">${n} screenshot${n === 1 ? '' : 's'} read in ${fmtTime(took)}.</p>
    <p>By hand, at about ${SECONDS_BY_HAND} seconds each to open, read, rename and drag, that's
       <strong>${fmtTime(byHand)}</strong> you didn't spend. Read on ${esc(device || 'this device')}, entirely in this tab.</p>
    <ul class="stats">
      <li><strong>${folders}</strong> folders</li>
      <li><strong>${flagged}</strong> flagged sensitive</li>
      <li><strong>${dups}</strong> duplicate${dups === 1 ? '' : 's'}</li>
    </ul>`;
}

// ---------------------------------------------------------------- the run

async function start(src: Source) {
  const run = ++runId;
  reset();
  source = src;
  shots = new Map(src.shots.map(s => [s.id, s]));
  for (const s of src.shots) thumbs.set(s.id, URL.createObjectURL(s.file));
  $('#hero').hidden = true;
  $('#work').hidden = false;
  $('#source-label').textContent = src.label;

  if (!src.shots.length) {
    setStatus('No images found here. Screenshot Sloth reads the PNG, JPEG and WebP files at the top level of a folder.');
    return;
  }
  if (src.kind === 'folder' && src.dir) {
    const log = await readLog(src.dir);
    if (log?.moves.length) {
      applied = log;
      setStatus(`This folder was sorted on ${new Date(log.at).toLocaleString()}. You can undo that run.`);
    }
  }
  render();

  busy = true;
  startedAt = performance.now();
  if (!modelReady) { setStatus('Loading the model…'); worker.postMessage({ type: 'load' }); }

  let i = 0;
  for (const shot of src.shots) {
    if (run !== runId) return;   // user hit "Start over"
    i++;
    try {
      const r = await analyzeOnWorker(shot.id, shot.file);
      if (run !== runId) return;
      const ext = (shot.name.match(/\.(\w+)$/)?.[1] ?? 'png').replace(/^jpeg$/i, 'jpg');
      analyses.set(shot.id, { id: shot.id, name: shot.name, ext, lastModified: shot.file.lastModified, lines: r.lines, imageHeight: r.height, caption: r.caption });
      hashes.set(shot.id, { id: shot.id, gray: r.gray, aspect: r.aspect, size: shot.file.size, words: wordsOf(r.lines.map(l => l.text).join(' ')) });
    } catch (err) {
      failed.set(shot.id, err instanceof Error ? err.message : String(err));
    }
    const each = (performance.now() - startedAt) / i;
    setStatus(`Read ${i} of ${src.shots.length} on ${device || '…'} · about ${fmtTime(each * (src.shots.length - i))} left`);
    setMeter(i / src.shots.length);
    recompute();
    render();
  }

  busy = false; done = true;
  finishedAt = performance.now();
  recompute();
  render();
  renderPayoff();
  setStatus(applied
    ? 'Done. Undo the earlier run first, then you can apply this one.'
    : 'Done. Check the plan, fix any name you don\'t like, untick anything to leave alone, then apply.');
}

function reset() {
  for (const url of thumbs.values()) URL.revokeObjectURL(url);
  for (const m of [analyses, hashes, failed, thumbs, renamed]) m.clear();
  excluded.clear();
  plan = []; busy = false; done = false; applied = null;
  $('#payoff').hidden = true;
  setMeter(0);
}

async function apply() {
  if (!source || !done) return;
  const btn = $<HTMLButtonElement>('#apply');
  const items = plan.filter(p => p.include);

  if (source.kind === 'folder' && source.dir) {
    if (applied) {
      btn.disabled = true;
      const log = applied;
      await undoMoves(source.dir, log, n => setStatus(`Putting back ${n} of ${log.moves.length}…`));
      applied = null;
      setStatus(`Put ${log.moves.length} files back where they were.`);
      // The originals are back under their old names; re-read the folder (no new prompt) so a fresh run starts clean.
      return start(await listFolder(source.dir));
    }
    const folders = new Set(items.map(p => p.folder)).size;
    if (!confirm(`Move ${items.length} files into ${folders} folders inside "${source.label}"?\n\nEvery move is logged, so you can undo it from this page.`)) return;
    btn.disabled = true;
    try {
      applied = await applyMoves(source.dir, shots, items, n => { setStatus(`Moving ${n} of ${items.length}…`); setMeter(n / items.length); });
      setStatus(`Moved ${applied.moves.length} files. Changed your mind? Undo puts every one back.`);
    } catch (err) {
      applied = await readLog(source.dir);
      setStatus(`Stopped partway: ${err instanceof Error ? err.message : err}. Whatever moved can be undone.`);
    }
    render();
    return;
  }

  btn.disabled = true;
  setStatus('Zipping…');
  const blob = await zipPlan(shots, items);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'screenshots-sorted.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  setStatus(`Downloaded screenshots-sorted.zip (${(blob.size / 1e6).toFixed(1)} MB). Your originals weren't touched.`);
  updateApply();
}

// ---------------------------------------------------------------- wiring

if (canPickFolder()) {
  $('#pick-folder').hidden = false;
  $('#browser-note').textContent = 'Files are moved inside the folder you pick, and every move can be undone. You see the whole plan before anything moves.';
} else {
  $('#pick-files').hidden = false;
  $('#browser-note').textContent = 'This browser can\'t move files in a folder, so you\'ll get a sorted .zip and your originals stay where they are. Chrome and Edge can sort in place.';
}

$('#pick-folder').addEventListener('click', async () => {
  try { start(await pickFolder()); }
  catch (err) { if ((err as DOMException)?.name !== 'AbortError') alert(String(err)); }
});
$<HTMLInputElement>('#pick-files input').addEventListener('change', e => {
  const files = (e.target as HTMLInputElement).files;
  if (files?.length) start(fromFiles(files));
});
$('#demo').addEventListener('click', async () => start(await demoSource()));
$('#restart').addEventListener('click', () => {
  if (busy && !confirm('Stop reading and start over?')) return;
  runId++;
  reset();
  $('#work').hidden = true;
  $('#hero').hidden = false;
});
$('#apply').addEventListener('click', apply);

$('#plan').addEventListener('change', e => {
  const t = e.target as HTMLInputElement;
  const id = t.closest<HTMLElement>('.row')?.dataset.id;
  if (!id) return;
  if (t.type === 'checkbox') {
    if (t.checked) excluded.delete(id); else excluded.add(id);
  } else if (t.classList.contains('to')) {
    const v = t.value.trim().replace(/[\\/:*?"<>|]/g, '-');
    const ext = shots.get(id)!.name.match(/\.\w+$/)?.[0] ?? '';
    if (v) renamed.set(id, /\.\w+$/.test(v) ? v : v + ext.toLowerCase());
  }
  recompute();
  render();
});

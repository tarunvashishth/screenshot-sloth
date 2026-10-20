// Pure logic: no DOM, no model. Everything here is unit-tested in rules.test.ts.
// The model only reads the screenshot; these rules decide what to call it,
// where it goes, and whether it holds something you shouldn't keep around.

export type Category =
  | 'receipt' | 'chat' | 'error' | 'code' | 'ticket'
  | 'map' | 'document' | 'photo' | 'other';

export const FOLDERS: Record<Category, string> = {
  receipt: 'Receipts',
  chat: 'Chats',
  error: 'Errors',
  code: 'Code',
  ticket: 'Tickets',
  map: 'Maps',
  document: 'Documents',
  photo: 'Photos',
  other: 'Other',
};

export const DUPLICATES_FOLDER = '_Duplicates';
export const REVIEW_FOLDER = '_Review (sensitive)';

/** One OCR line with its box, as Florence-2 <OCR_WITH_REGION> returns it. */
export interface Line { text: string; top: number; height: number }

// ---------------------------------------------------------------- dates

export interface ShotMeta { date: string | null; app: string | null }

const pad = (n: number | string) => String(n).padStart(2, '0');

/** Pull the capture date (and, on Android, the app) out of a screenshot's filename. */
export function parseFilename(name: string): ShotMeta {
  let m: RegExpMatchArray | null;
  // Android: Screenshot_20261003-142201_WhatsApp.jpg / Screenshot_20261003_142201_com.whatsapp.png
  m = name.match(/Screenshot_(\d{4})(\d{2})(\d{2})[-_]\d{6}(?:_(.+?))?\.\w+$/i);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, app: m[4] ? cleanApp(m[4]) : null };
  // macOS / Windows: "Screenshot 2026-10-03 at 14.22.01.png", "Screen Shot 2026-10-03 at 2.22.01 PM.png",
  // "Screenshot 2026-10-03 142201.png"
  m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, app: null };
  m = name.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    return { date: `${m[1]}-${m[2]}-${m[3]}`, app: null };
  }
  return { date: null, app: null };
}

function cleanApp(raw: string): string | null {
  // "com.whatsapp" -> "whatsapp", "Google Pay" -> "google-pay"
  const last = raw.includes('.') ? raw.split('.').pop()! : raw;
  return slugify(last) || null;
}

export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** True for names a human didn't choose: "Screenshot ...", "IMG_1234", "image (3)". */
export function looksUnnamed(name: string): boolean {
  return /^(screen ?shot|screenshot_|img_|image|photo|capture|snip|scr_|cleanshot)/i.test(name);
}

// ---------------------------------------------------------------- categories

const SIGNALS: [Category, RegExp, number][] = [
  ['receipt', /\b(total|subtotal|amount|paid|payment|order (?:id|#|no)|invoice|receipt|gst|tax|refund|transaction|debited|credited|txn|bill)\b|₹|\brs\.?\s?\d|\$\s?\d/gi, 2],
  ['chat', /\b(typing|online|last seen|delivered|message|reply|replied|whatsapp|telegram|imessage|forwarded|read \d)\b/gi, 2],
  ['error', /\b(error|exception|failed|failure|traceback|undefined|cannot|can't|denied|not found|crash(?:ed)?|warning|stack trace|refused)\b|\b(?:4\d\d|5\d\d)\b(?= ?[a-z])/gi, 2],
  ['code', /\b(function|const|let|import|export|return|def|class|async|await|npm|git|console\.log|null|true|false)\b|=>|\{\s*$|;\s*$/gim, 1],
  ['ticket', /\b(boarding|pnr|gate|seat|flight|departure|arrival|platform|coach|berth|booking (?:id|ref)|e-?ticket)\b/gi, 3],
  ['map', /\b(\d+(?:\.\d+)? ?km|directions|route|min drive|via|arrive by|start navigation|eta)\b/gi, 2],
];

const CAPTION_HINTS: [Category, RegExp][] = [
  ['map', /\bmap\b/i],
  ['chat', /\b(text messages?|chat|conversation|messaging)\b/i],
  ['code', /\b(code|programming|terminal|command line)\b/i],
  ['receipt', /\b(receipt|invoice|bill)\b/i],
];

export function categorize(text: string, caption: string, app: string | null): Category {
  if (app && /whatsapp|telegram|messages|signal|instagram|messenger|slack|discord/.test(app)) return 'chat';
  if (app && /maps/.test(app)) return 'map';
  if (app && /pay|paytm|phonepe|swiggy|zomato|amazon|flipkart|bank/.test(app) && /₹|total|paid|amount/i.test(text)) return 'receipt';

  const score = new Map<Category, number>();
  for (const [cat, re, w] of SIGNALS) {
    const hits = text.match(re)?.length ?? 0;
    if (hits) score.set(cat, hits * w);
  }
  for (const [cat, re] of CAPTION_HINTS) {
    if (re.test(caption)) score.set(cat, (score.get(cat) ?? 0) + 3);
  }
  let best: Category = 'other', bestScore = 0;
  for (const [cat, s] of score) if (s > bestScore) { best = cat; bestScore = s; }
  if (bestScore >= 3) return best;

  const letters = text.replace(/[^\p{L}]/gu, '').length;
  if (letters < 15) return 'photo';
  if (letters > 400) return 'document';
  return 'other';
}

// ---------------------------------------------------------------- naming

// Status bar and buttons: big, bold, and never what the screen is about.
const CHROME = new RegExp('^(' + [
  '\\d{1,2}[:.]\\d{2}(\\s?[ap]m)?', '\\d{1,3}%', 'lte', '[45]g', 'wi-?fi',
  'search', 'back', 'done', 'cancel', 'edit', 'share', 'more', 'menu', 'home', 'settings', 'ok', 'close', 'x',
  'save', 'call', 'message', 'reply', 'follow', 'subscribe', 'continue', 'next', 'skip', 'allow', 'open', 'install',
  'sign in', 'log in', 'login', 'sign up', 'buy now', 'add to cart', 'pay now', 'view details', 'see all',
  'start( navigation)?', '(get )?directions', 'navigate', 'steps', 'type a message',
].join('|') + ')$', 'i');
const STOP = new Set('a an the of and or to in on for with at by from is are was this that your you my our it its be as'.split(' '));

const UNITS = new Set('min mins hr hrs sec km mi m kb mb gb am pm rs inr usd'.split(' '));

/** A line is a title candidate if it has at least one real word, not just numbers and units. */
const hasWord = (t: string) => (t.toLowerCase().match(/\p{L}{3,}/gu) ?? []).some(w => !UNITS.has(w));

/**
 * Lines most likely to be the screen's subject, best first: the tallest text
 * that isn't phone chrome (clock, battery, nav buttons) or the status bar.
 */
export function headlines(lines: Line[], imageHeight: number): string[] {
  return lines
    .map(l => ({ ...l, text: l.text.trim() }))
    .filter(l => l.top > imageHeight * 0.04)          // below the status bar
    .filter(l => hasWord(l.text))
    .filter(l => !CHROME.test(l.text))
    // Prefer big text; break ties toward the top of the screen.
    .sort((a, b) => (b.height - a.height) || (a.top - b.top))
    .map(l => l.text);
}

export function slugify(s: string, maxWords = 4, maxLen = 40): string {
  const words = s
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w && !STOP.has(w));
  let out = '';
  for (const w of words.slice(0, maxWords)) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > maxLen) break;
    out = next;
  }
  return out;
}

/** "a screenshot of a map showing a route" -> "map showing route" */
export function captionSubject(caption: string): string {
  return caption
    .replace(/<[^>]+>/g, '')
    .replace(/^\s*(the image (shows|is)|this is|an? (screenshot|image|picture|photo) of)\s*/i, '')
    .replace(/^\s*(an? (screenshot|image|picture|photo) of)\s*/i, '')
    .replace(/^\s*(an?|the)\s+/i, '')
    .trim();
}

export function suggestName(opts: {
  date: string; category: Category; app: string | null;
  headlines: string[]; caption: string; ext: string;
}): string {
  // "maps" app + "map" category, "messages" app + "chat": say it once.
  const app = opts.app && !opts.app.startsWith(opts.category) ? opts.app : null;
  const prefix = [opts.date, opts.category === 'other' ? null : opts.category, app].filter((p): p is string => !!p);
  const used = new Set(prefix.join('-').split('-'));
  // A headline only counts if it adds a real word the prefix doesn't already say:
  // "E-Ticket" under ticket/ adds only "e", so fall through to the next line.
  const fresh = (slug: string) => slug.split('-').filter(w => !used.has(w));
  let subject: string[] = [];
  for (const h of opts.headlines.slice(0, 4)) {
    const words = fresh(slugify(h));
    if (words.some(w => w.length >= 3)) { subject = words; break; }
  }
  if (!subject.length) subject = fresh(slugify(captionSubject(opts.caption)));
  return `${[...prefix, ...subject].join('-')}.${opts.ext.toLowerCase()}`;
}

/** Make `name` unique against `taken` by appending -2, -3, ... before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name; }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const n = `${base}-${i}${ext}`;
    if (!taken.has(n.toLowerCase())) { taken.add(n.toLowerCase()); return n; }
  }
}

// ---------------------------------------------------------------- sensitive data

export type SensitiveKind = 'card' | 'aadhaar' | 'pan' | 'otp' | 'password' | 'upi' | 'iban';
export interface Finding { kind: SensitiveKind; masked: string }

export const KIND_LABEL: Record<SensitiveKind, string> = {
  card: 'Card number',
  aadhaar: 'Aadhaar number',
  pan: 'PAN',
  otp: 'One-time code',
  password: 'Password',
  upi: 'UPI ID',
  iban: 'IBAN',
};

export function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d; alt = !alt;
  }
  return sum % 10 === 0;
}

// Verhoeff tables (Aadhaar's check digit).
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];

export function verhoeff(digits: string): boolean {
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = VD[c][VP[i % 8][+rev[i]]];
  return c === 0;
}

const last4 = (s: string) => '•••• ' + s.slice(-4);

export function findSensitive(text: string): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  const add = (kind: SensitiveKind, value: string, masked: string) => {
    const key = kind + value;
    if (!seen.has(key)) { seen.add(key); out.push({ kind, masked }); }
  };

  // Digit runs, allowing the spaces/dashes OCR keeps between groups.
  for (const m of text.matchAll(/(?<![\d])\d(?:[ -]?\d){11,18}(?![\d])/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (/^(\d)\1+$/.test(digits)) continue;
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) add('card', digits, last4(digits));
    else if (digits.length === 12 && /^[2-9]/.test(digits) && verhoeff(digits)) add('aadhaar', digits, last4(digits));
  }
  for (const m of text.matchAll(/\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g)) add('pan', m[0], m[0].slice(0, 2) + '•••••' + m[0].slice(-3));

  if (/\b(otp|one[- ]time (?:password|code)|verification code|login code|security code|passcode|2fa code)\b/i.test(text)) {
    // A full stop after the code is a sentence end, not a decimal: "is 482913." still counts.
    const code = text.match(/(?<![\d₹$.,])\b\d{4,8}\b(?![\d]|[.,]\d)/);
    if (code) add('otp', code[0], '•'.repeat(code[0].length));
  }
  for (const m of text.matchAll(/\b(?:password|passwd|pwd|pin)\s*[:=]\s*(\S{4,})/gi)) add('password', m[1], '•'.repeat(8));
  for (const m of text.matchAll(/\b[\w.-]{2,}@(?:ok(?:axis|hdfcbank|icici|sbi)|ybl|paytm|upi|apl|ibl|axl|ptyes|ptsbi)\b/gi)) {
    add('upi', m[0].toLowerCase(), m[0].replace(/^(.{2}).*@/, '$1•••@'));
  }
  for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}\b/g)) {
    if (/\d{6}/.test(m[0].replace(/\s/g, ''))) add('iban', m[0], m[0].slice(0, 4) + ' •••• ' + m[0].slice(-4));
  }
  return out;
}

// ---------------------------------------------------------------- duplicates

/**
 * Mean absolute difference between two same-size grayscale thumbnails, 0-255.
 * Re-saved and re-compressed copies of one screenshot score about 1-2.
 */
export function thumbDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 255;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

export interface Hashed { id: string; gray: ArrayLike<number>; aspect: number; size: number; words: Set<string> }

/**
 * Group near-identical screenshots. Returns a map of duplicate id -> the id it
 * duplicates. The keeper in each group is the largest file (best quality).
 *
 * Image similarity alone is useless here: most screenshots are a white page
 * with a little text, so any two of them "look alike". A duplicate has to look
 * alike AND read alike. Text-free images (photos) fall back to a stricter
 * pixel threshold.
 */
export function findDuplicates(items: Hashed[]): Map<string, string> {
  const dupOf = new Map<string, string>();
  const sorted = [...items].sort((a, b) => b.size - a.size);
  const keepers: Hashed[] = [];
  const isDup = (k: Hashed, it: Hashed) => {
    if (Math.abs(k.aspect - it.aspect) > 0.01) return false;
    const d = thumbDistance(k.gray, it.gray);
    const textless = k.words.size < 3 && it.words.size < 3;
    return textless ? d < 2 : d < 6 && jaccard(k.words, it.words) >= 0.8;
  };
  for (const it of sorted) {
    const k = keepers.find(k => isDup(k, it));
    if (k) dupOf.set(it.id, k.id); else keepers.push(it);
  }
  return dupOf;
}

// ---------------------------------------------------------------- the plan

export interface Analysis {
  id: string; name: string; ext: string; lastModified: number;
  lines: Line[]; imageHeight: number; caption: string;
}

export interface PlanItem {
  id: string;
  from: string;
  folder: string;
  to: string;
  category: Category;
  findings: Finding[];
  duplicateOf: string | null;
  include: boolean;
}

/** `keepName`: the file already has a name a person chose, so only file it, don't rename it. */
export function planFor(a: Analysis, dupOf: string | null, taken: Set<string>, keepName = false): PlanItem {
  const text = a.lines.map(l => l.text).join('\n');
  const meta = parseFilename(a.name);
  const category = categorize(text, a.caption, meta.app);
  const findings = findSensitive(text);
  const name = keepName ? a.name : suggestName({
    date: meta.date ?? isoDate(a.lastModified),
    category, app: meta.app,
    headlines: headlines(a.lines, a.imageHeight),
    caption: a.caption, ext: a.ext,
  });
  const folder = dupOf ? DUPLICATES_FOLDER : findings.length ? REVIEW_FOLDER : FOLDERS[category];
  return {
    id: a.id, from: a.name, folder, to: uniqueName(name, taken),
    category, findings, duplicateOf: dupOf, include: true,
  };
}

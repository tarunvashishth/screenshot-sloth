// A demo "Desktop" of synthetic screenshots, drawn in the page so the repo
// ships nobody's real data. Every name, number and card here is fake
// (4111 1111 1111 1111 is the standard test card; the Aadhaar-shaped number
// is UIDAI's sample format).
import type { Source, Shot } from './fs.ts';

const W = 590, H = 1278;   // half an iPhone screenshot: big enough to read, quick to process

type Painter = (ctx: OffscreenCanvasRenderingContext2D) => void;

const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, Menlo, Consolas, monospace';

function statusBar(ctx: OffscreenCanvasRenderingContext2D, dark = false) {
  ctx.fillStyle = dark ? '#fff' : '#000';
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText('9:41', 40, 38);
  ctx.fillText('87%', W - 90, 38);
}

function text(ctx: OffscreenCanvasRenderingContext2D, s: string, x: number, y: number, size: number, weight = 400, color = '#111', font = FONT) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillText(s, x, y);
}

function bg(ctx: OffscreenCanvasRenderingContext2D, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}

const receipt: Painter = ctx => {
  bg(ctx, '#fff'); statusBar(ctx);
  text(ctx, 'Tandoor Express', 40, 150, 46, 700);
  text(ctx, 'Order #TX-48213 · Delivered', 40, 200, 24, 400, '#555');
  const rows: [string, string][] = [['Paneer Tikka x1', '₹280'], ['Butter Naan x3', '₹120'], ['Item total', '₹400'], ['GST', '₹20'], ['Delivery fee', '₹35']];
  rows.forEach(([a, b], i) => { text(ctx, a, 40, 300 + i * 56, 28); text(ctx, b, W - 140, 300 + i * 56, 28); });
  ctx.fillStyle = '#ddd'; ctx.fillRect(40, 590, W - 80, 2);
  text(ctx, 'Total paid', 40, 650, 32, 700); text(ctx, '₹455', W - 150, 650, 32, 700);
  text(ctx, 'Paid via UPI on 3 Oct 2026', 40, 710, 24, 400, '#555');
};

const error: Painter = ctx => {
  bg(ctx, '#1e1e1e'); statusBar(ctx, true);
  text(ctx, 'Build failed', 40, 150, 44, 700, '#ff6b6b');
  const lines = [
    "TypeError: Cannot read properties",
    "of undefined (reading 'map')",
    '  at renderList (list.tsx:42:18)',
    '  at App (App.tsx:12:5)',
    '',
    'npm ERR! code ELIFECYCLE',
    'npm ERR! errno 1',
  ];
  lines.forEach((l, i) => text(ctx, l, 40, 240 + i * 44, 24, 400, i < 2 ? '#ffb4b4' : '#ccc', MONO));
};

const chat: Painter = ctx => {
  bg(ctx, '#efeae2'); statusBar(ctx);
  ctx.fillStyle = '#f7f7f7'; ctx.fillRect(0, 60, W, 110);
  text(ctx, 'Rohan', 110, 125, 34, 600);
  text(ctx, 'online', 110, 155, 20, 400, '#666');
  const bubble = (s: string, y: number, mine: boolean) => {
    ctx.font = `400 26px ${FONT}`;
    const w = ctx.measureText(s).width + 40;
    const x = mine ? W - w - 30 : 30;
    ctx.fillStyle = mine ? '#d9fdd3' : '#fff';
    ctx.beginPath(); ctx.roundRect(x, y, w, 60, 16); ctx.fill();
    text(ctx, s, x + 20, y + 40, 26);
  };
  bubble('Running 10 min late', 230, false);
  bubble('No worries, grab a table', 310, true);
  bubble('Which cafe again?', 390, false);
  bubble('Blue Tokai, Hauz Khas', 470, true);
  text(ctx, 'Type a message', 50, H - 60, 26, 400, '#999');
};

const otp: Painter = ctx => {
  bg(ctx, '#fff'); statusBar(ctx);
  text(ctx, 'Messages', 40, 140, 44, 700);
  text(ctx, 'VM-SLBANK', 40, 230, 28, 600);
  ctx.fillStyle = '#e9e9eb'; ctx.beginPath(); ctx.roundRect(30, 260, W - 100, 190, 22); ctx.fill();
  ['Your OTP for login is 482913.', 'Valid for 10 minutes. Do not', 'share it with anyone. - SL Bank'].forEach((l, i) => text(ctx, l, 55, 315 + i * 44, 27));
};

const ticket: Painter = ctx => {
  bg(ctx, '#fff'); statusBar(ctx);
  text(ctx, 'E-Ticket', 40, 150, 46, 700);
  text(ctx, 'Shatabdi Express 12002', 40, 210, 28, 600, '#333');
  const kv: [string, string][] = [['PNR', '4512873390'], ['Departure', '06:10 New Delhi'], ['Arrival', '08:05 Agra Cantt'], ['Coach', 'C2'], ['Seat', '34 Window']];
  kv.forEach(([k, v], i) => { text(ctx, k, 40, 300 + i * 70, 24, 400, '#777'); text(ctx, v, 240, 300 + i * 70, 28, 600); });
};

const code: Painter = ctx => {
  bg(ctx, '#0d1117'); statusBar(ctx, true);
  text(ctx, 'debounce.ts', 40, 140, 34, 600, '#e6edf3');
  const lines = [
    'export function debounce(fn, ms) {',
    '  let t;',
    '  return (...args) => {',
    '    clearTimeout(t);',
    '    t = setTimeout(() => fn(...args), ms);',
    '  };',
    '}',
    '',
    "import { debounce } from './debounce';",
    'const save = debounce(sync, 300);',
  ];
  lines.forEach((l, i) => text(ctx, l, 30, 220 + i * 42, 21, 400, '#c9d1d9', MONO));
};

const card: Painter = ctx => {
  bg(ctx, '#f2f2f7'); statusBar(ctx);
  text(ctx, 'Card details', 40, 150, 44, 700);
  ctx.fillStyle = '#1f3b73'; ctx.beginPath(); ctx.roundRect(40, 200, W - 80, 300, 26); ctx.fill();
  text(ctx, 'SL BANK PLATINUM', 70, 260, 24, 700, '#fff');
  text(ctx, '4111 1111 1111 1111', 70, 380, 36, 600, '#fff', MONO);
  text(ctx, 'VALID THRU 08/29', 70, 450, 22, 400, '#dbe4ff');
  text(ctx, 'Card number', 40, 580, 24, 400, '#777');
  text(ctx, '4111 1111 1111 1111', 40, 620, 30, 600);
};

const map: Painter = ctx => {
  bg(ctx, '#e8f0e3');
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 18;
  for (let i = 0; i < 9; i++) { ctx.beginPath(); ctx.moveTo(0, 120 + i * 130); ctx.lineTo(W, 60 + i * 150); ctx.stroke(); }
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(60 + i * 130, 0); ctx.lineTo(120 + i * 110, H); ctx.stroke(); }
  ctx.strokeStyle = '#1a73e8'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(120, 900); ctx.lineTo(250, 640); ctx.lineTo(380, 520); ctx.lineTo(450, 260); ctx.stroke();
  statusBar(ctx);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, H - 250, W, 250);
  text(ctx, '18 min (6.4 km)', 40, H - 170, 36, 700, '#188038');
  text(ctx, 'Fastest route via Aurobindo Marg', 40, H - 120, 24, 400, '#444');
  text(ctx, 'Start navigation', 40, H - 60, 26, 600, '#1a73e8');
};

const photo: Painter = ctx => {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#ff9a5a'); g.addColorStop(0.55, '#ffd27f'); g.addColorStop(0.56, '#2d6f8f'); g.addColorStop(1, '#173b52');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(W / 2, 690, 90, 0, Math.PI * 2); ctx.fill();
};

const article: Painter = ctx => {
  bg(ctx, '#fffdf8'); statusBar(ctx);
  text(ctx, 'Why sloths come down', 40, 150, 40, 700);
  text(ctx, 'from the trees', 40, 200, 40, 700);
  const body = 'Three-toed sloths spend almost their whole lives in the canopy, yet once a week they climb all the way down to the forest floor. It is the most dangerous thing they do, and for decades nobody could explain why. The answer turned out to involve moths, algae and a surprisingly elegant little ecosystem living in their fur. The moths lay eggs in the dung, the larvae grow up there, and the adults fly back up to the sloth, bringing nutrients that feed the algae the sloth later eats.';
  ctx.font = `400 26px Georgia, serif`;
  let line = '', y = 280;
  for (const w of body.split(' ')) {
    if (ctx.measureText(line + w).width > W - 80) { text(ctx, line, 40, y, 26, 400, '#222', 'Georgia, serif'); line = ''; y += 42; }
    line += w + ' ';
  }
  text(ctx, line, 40, y, 26, 400, '#222', 'Georgia, serif');
};

const boarding: Painter = ctx => {
  bg(ctx, '#fff'); statusBar(ctx);
  text(ctx, 'Boarding Pass', 40, 150, 46, 700);
  text(ctx, 'DEL → BLR · Flight SL 204', 40, 210, 28, 600, '#333');
  const kv: [string, string][] = [['Gate', '22'], ['Seat', '14C'], ['Boarding', '19:35'], ['Departure', '20:05']];
  kv.forEach(([k, v], i) => { text(ctx, k, 40, 310 + i * 80, 24, 400, '#777'); text(ctx, v, 240, 310 + i * 80, 34, 700); });
  ctx.fillStyle = '#111';
  for (let i = 0; i < 60; i++) if ((i * 7919) % 3) ctx.fillRect(40 + i * 8.5, 720, 5, 120);
};

// [painter, filename, minutes before "now", format]
const SHOTS: [Painter, string, number, 'png' | 'jpeg'][] = [
  [receipt, 'Screenshot 2026-10-03 at 13.04.11.png', 0, 'png'],
  [error, 'Screenshot 2026-10-06 at 22.17.40.png', 0, 'png'],
  [chat, 'Screenshot_20261008-191502_WhatsApp.jpg', 0, 'jpeg'],
  [otp, 'Screenshot 2026-10-09 at 10.02.55.png', 0, 'png'],
  [ticket, 'IMG_4821.PNG', 60 * 24 * 9, 'png'],
  [code, 'Screenshot 2026-10-11 at 16.40.09.png', 0, 'png'],
  [card, 'Screenshot 2026-10-12 at 09.12.31.png', 0, 'png'],
  [map, 'Screenshot_20261014-083012_Maps.png', 0, 'png'],
  [photo, 'Screenshot 2026-10-15 at 18.55.20.png', 0, 'png'],
  [article, 'Screenshot 2026-10-16 at 23.48.02.png', 0, 'png'],
  [boarding, 'Screenshot 2026-10-17 at 19.20.44.png', 0, 'png'],
  [receipt, 'Screenshot 2026-10-03 at 13.04.11 (2).jpg', 0, 'jpeg'],   // the one you saved twice
];

export async function demoSource(): Promise<Source> {
  const shots: Shot[] = [];
  const now = Date.now();
  for (const [paint, name, minsAgo, fmt] of SHOTS) {
    const c = new OffscreenCanvas(W, H);
    paint(c.getContext('2d')!);
    const blob = await c.convertToBlob({ type: `image/${fmt}`, quality: 0.85 });
    shots.push({ id: crypto.randomUUID(), name, file: new File([blob], name, { type: blob.type, lastModified: now - minsAgo * 60_000 }) });
  }
  return { kind: 'demo', label: 'Demo Desktop', shots };
}

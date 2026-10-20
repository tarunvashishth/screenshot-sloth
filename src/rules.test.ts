import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFilename, looksUnnamed, categorize, headlines, slugify, suggestName, uniqueName,
  luhn, verhoeff, findSensitive, thumbDistance, wordsOf, jaccard, findDuplicates, planFor, captionSubject,
  REVIEW_FOLDER, DUPLICATES_FOLDER,
} from './rules.ts';

test('parses dates and apps from common screenshot filenames', () => {
  assert.deepEqual(parseFilename('Screenshot 2026-10-03 at 14.22.01.png'), { date: '2026-10-03', app: null });
  assert.deepEqual(parseFilename('Screen Shot 2026-10-03 at 2.22.01 PM.png'), { date: '2026-10-03', app: null });
  assert.deepEqual(parseFilename('Screenshot 2026-10-03 142201.png'), { date: '2026-10-03', app: null });
  assert.deepEqual(parseFilename('Screenshot_20261003-142201_WhatsApp.jpg'), { date: '2026-10-03', app: 'whatsapp' });
  assert.deepEqual(parseFilename('Screenshot_20261003_142201_com.google.android.apps.maps.png'), { date: '2026-10-03', app: 'maps' });
  assert.deepEqual(parseFilename('IMG_4821.PNG'), { date: null, app: null });
});

test('recognises names nobody chose', () => {
  assert.ok(looksUnnamed('Screenshot 2026-10-03 at 14.22.01.png'));
  assert.ok(looksUnnamed('IMG_4821.PNG'));
  assert.ok(!looksUnnamed('swiggy-refund.png'));
});

test('categorises from OCR text, caption and app', () => {
  assert.equal(categorize('Order #4821\nItem total ₹420\nGST ₹21\nPaid via UPI', '', null), 'receipt');
  assert.equal(categorize('TypeError: Cannot read properties of undefined\n at main.ts:12', '', null), 'error');
  assert.equal(categorize('PNR 4512873390\nCoach B2 Berth 34\nDeparture 06:10', '', null), 'ticket');
  assert.equal(categorize('hey are you coming', '', 'whatsapp'), 'chat');
  assert.equal(categorize('', 'a dog sitting on a beach at sunset', null), 'photo');
  assert.equal(categorize('Hauz Khas', 'a map of a city with a route', null), 'map');
});

test('picks the tallest non-chrome line as the headline', () => {
  const lines = [
    { text: '9:41', top: 5, height: 30 },        // status bar clock
    { text: '87%', top: 5, height: 30 },
    { text: 'Back', top: 120, height: 40 },
    { text: 'Swiggy Instamart', top: 160, height: 64 },
    { text: 'Your order is on the way', top: 260, height: 36 },
    { text: '₹ 482.00', top: 300, height: 80 },   // pure amount, not a title
    { text: '18 min (6.4 km)', top: 400, height: 70 }, // numbers and units, not a title
    { text: 'Start navigation', top: 500, height: 70 }, // a button
  ];
  assert.deepEqual(headlines(lines, 2000), ['Swiggy Instamart', 'Your order is on the way']);
  assert.deepEqual(headlines([{ text: '9:41', top: 5, height: 30 }], 2000), []);
});

test('slugifies to a short, filesystem-safe name', () => {
  assert.equal(slugify('Your Order from Café Coffee Day!'), 'order-cafe-coffee-day');
  assert.equal(slugify('  ¿¿  '), '');
  assert.equal(captionSubject('A screenshot of a map showing a route'), 'map showing a route');
});

test('builds names without repeating words', () => {
  const base = { date: '2026-10-03', caption: '', ext: 'PNG' };
  assert.equal(suggestName({ ...base, category: 'chat', app: 'whatsapp', headlines: ['WhatsApp', 'Rohan'] }), '2026-10-03-chat-whatsapp-rohan.png');
  assert.equal(suggestName({ ...base, category: 'map', app: 'maps', headlines: ['Fastest route via Aurobindo Marg'] }), '2026-10-03-map-fastest-route-via-aurobindo.png');
  // "E-Ticket" adds nothing under ticket/, so the next line names it.
  assert.equal(suggestName({ ...base, category: 'ticket', app: null, headlines: ['E-Ticket', 'Shatabdi Express 12002'] }), '2026-10-03-ticket-shatabdi-express-12002.png');
  assert.equal(suggestName({ ...base, category: 'other', app: null, headlines: [], caption: 'A screenshot of a calendar' }), '2026-10-03-calendar.png');
});

test('keeps names unique', () => {
  const taken = new Set<string>();
  assert.equal(uniqueName('a.png', taken), 'a.png');
  assert.equal(uniqueName('A.png', taken), 'A-2.png');
  assert.equal(uniqueName('a.png', taken), 'a-3.png');
});

test('checksums', () => {
  assert.ok(luhn('4111111111111111'));
  assert.ok(!luhn('4111111111111112'));
  assert.ok(verhoeff('234123412346'));   // UIDAI's published sample-format number
  assert.ok(!verhoeff('234123412347'));
});

test('finds sensitive data and masks it', () => {
  const f = findSensitive('Card 4111 1111 1111 1111\nAadhaar 2341 2341 2346\nPAN ABCPE1234F\nYour OTP is 482913. Do not share.\nPay tarun@okaxis');
  assert.deepEqual(f.map(x => x.kind).sort(), ['aadhaar', 'card', 'otp', 'pan', 'upi']);
  assert.equal(f.find(x => x.kind === 'card')!.masked, '•••• 1111');
  assert.ok(f.every(x => !x.masked.includes('482913') && !x.masked.includes('2341 2341')));
});

test('an OTP at the end of a sentence still counts', () => {
  assert.deepEqual(findSensitive('Your OTP for login is 482913.\nValid for 10 minutes.').map(f => f.kind), ['otp']);
  assert.deepEqual(findSensitive('Your OTP is ready. Amount 1299.50'), []);   // a decimal isn't a code
});

test('does not flag ordinary numbers', () => {
  assert.deepEqual(findSensitive('Order #4111111111111112 total ₹1,299 on 2026-10-03'), []);
  assert.deepEqual(findSensitive('Call 1800 1234 5678 for help'), []);
  assert.deepEqual(findSensitive('Delivered in 1234 minutes'), []);   // no OTP keyword
});

test('duplicates must look alike and read alike', () => {
  const white = new Uint8Array(1024).fill(250);
  const whiteish = white.map((v, i) => i % 7 ? v : v - 6);   // re-compressed copy
  assert.ok(thumbDistance(white, whiteish) < 1);
  assert.ok(jaccard(wordsOf('Total paid 455'), wordsOf('total PAID 455')) === 1);

  const receipt = wordsOf('Tandoor Express Order TX-48213 Paneer Tikka Butter Naan Total paid 455');
  const chat = wordsOf('Rohan online Running 10 min late No worries grab a table');
  const dups = findDuplicates([
    { id: 'small', gray: whiteish, aspect: 0.46, size: 100, words: receipt },
    { id: 'big', gray: white, aspect: 0.46, size: 900, words: receipt },     // same screen: duplicate, and the keeper
    { id: 'chat', gray: white, aspect: 0.46, size: 500, words: chat },       // looks the same (white), reads differently
    { id: 'wide', gray: white, aspect: 1.6, size: 500, words: receipt },     // same text, different shape
  ]);
  assert.deepEqual([...dups], [['small', 'big']]);
});

test('plan routes sensitive and duplicate shots to review folders', () => {
  const base = { ext: 'png', lastModified: Date.UTC(2026, 9, 3), imageHeight: 2000, caption: '' };
  const taken = new Set<string>();
  const otp = planFor({ ...base, id: '1', name: 'Screenshot 2026-10-03 at 14.22.01.png',
    lines: [{ text: 'Your OTP is 482913', top: 300, height: 40 }] }, null, taken);
  assert.equal(otp.folder, REVIEW_FOLDER);
  const dup = planFor({ ...base, id: '2', name: 'Screenshot 2026-10-03 at 14.22.02.png',
    lines: [{ text: 'Your OTP is 482913', top: 300, height: 40 }] }, '1', taken);
  assert.equal(dup.folder, DUPLICATES_FOLDER);
  assert.notEqual(otp.to, dup.to);
});

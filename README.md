# Screenshot Sloth 🦥

Your screenshots folder, sorted while you lie down.

**Try it:** https://tarunvashishth.github.io/screenshot-sloth/ (Chrome or Edge to sort in place; any browser for the demo)

Point it at a folder full of `Screenshot 2026-10-03 at 14.22.01.png` files. An open-source vision model
reads every one **in your browser tab**, then proposes a plan:

- **Rename** each file for what's on it: `2026-10-03-receipt-tandoor-express.png`, `2026-10-06-error-build-failed.png`
- **File** them into folders: Receipts, Chats, Errors, Code, Tickets, Maps, Documents, Photos
- **Flag** the ones holding one-time codes, card numbers, Aadhaar, PAN, UPI IDs or passwords, and put them together
  in `_Review (sensitive)` so you can look once and delete
- **Catch duplicates** (the same screenshot saved twice) and set the extras aside in `_Duplicates`

You see the whole plan first, can fix any name or untick anything, then apply. Every move is logged to
`.screenshot-sloth-undo.json` in the folder, and **Undo** puts every file back.

Nothing is uploaded. The only network traffic is the one-time model download from Hugging Face (about 350 MB,
cached after that).

## How it works

```
file ──► createImageBitmap ──► up to 3 square-ish tiles (tall phone shots) ──► Florence-2 <OCR_WITH_REGION>
                           └─► whole-image thumbnail ─────────────────────────► Florence-2 <CAPTION>
                           └─► 9x8 grayscale ──► dHash (duplicates)

OCR lines + boxes, caption, filename ──► rules.ts ──► category, name, sensitive findings, folder
```

- **Model:** [Florence-2-base-ft](https://huggingface.co/microsoft/Florence-2-base-ft) (MIT, 0.23B params),
  ONNX build run by [Transformers.js](https://github.com/huggingface/transformers.js) on WebGPU, falling back to WASM.
  It runs in a Web Worker, so the page stays responsive.
- **Why tiles:** Florence squashes every input to 768×768. A 1179×2556 phone screenshot squashed that far loses
  its small text, so it's read as up to three strips, top first.
- **Naming:** the tallest line of text that isn't phone chrome (clock, battery, "Back") is usually the screen's
  title. Dates and, on Android, the app name come from the original filename. Files that already have a name a
  person chose keep it and are only filed.
- **Sensitive data:** pattern plus checksum, so random numbers don't trip it: Luhn for cards, Verhoeff for
  Aadhaar, PAN structure, and OTPs only when a 4–8 digit code appears next to words like "OTP" or
  "verification code". Findings are always shown masked.
- **Duplicates:** 64-bit difference hash with a strict threshold, and the aspect ratio must match too, because
  screenshots of the same app look alike. The largest copy is kept.
- **Moving files:** File System Access API (Chrome, Edge). It uses `FileSystemFileHandle.move()` where available,
  and otherwise copies, checks the size, then removes the original. Other browsers get a sorted `.zip` instead and
  the originals aren't touched.

## Run it

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # rules: naming, categories, checksums, duplicates
npm run build
```

Click **Try the demo desktop** to run it on 12 synthetic screenshots drawn in the page (fake receipt, OTP SMS,
test card `4111 1111 1111 1111`, a build error, a chat, a train ticket and a duplicate).

## Limits

- The categories come from rules over the OCR text, not a fine-tuned classifier, so unusual screens land in Other.
- Text below the third strip of a very long scrolling screenshot isn't read.
- HEIC isn't supported, because browsers can't decode it.

Built for the [Hacktoberfest 2026 Open-Source AI Challenge, Week 3: Slow and Steady](https://dev.to/challenges/hacktoberfest-week3-2026-10-19).

MIT licensed.

// Runs Florence-2 entirely in the browser. The only network traffic is the
// one-time model download from Hugging Face; screenshots never leave this tab.
import {
  AutoProcessor,
  Florence2ForConditionalGeneration,
  RawImage,
  env,
  type PreTrainedModel,
  type Processor,
} from '@huggingface/transformers';
import { headlines } from './rules.ts';

const MODEL_ID = 'onnx-community/Florence-2-base-ft';
env.allowLocalModels = false;

let model: PreTrainedModel | null = null;
let processor: Processor | null = null;

const post = (msg: unknown) => self.postMessage(msg);

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as any).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function load() {
  if (model) return;
  const webgpu = await hasWebGPU();
  const files = new Map<string, { loaded: number; total: number }>();

  const progress_callback = (p: any) => {
    if (p.status !== 'progress' || !p.total) return;
    files.set(p.file, { loaded: p.loaded, total: p.total });
    let loaded = 0, total = 0;
    for (const f of files.values()) { loaded += f.loaded; total += f.total; }
    post({ type: 'progress', loaded, total });
  };

  model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
    device: webgpu ? 'webgpu' : 'wasm',
    dtype: webgpu
      ? { embed_tokens: 'fp16', vision_encoder: 'fp16', encoder_model: 'q4', decoder_model_merged: 'q4' }
      : 'q8',
    progress_callback,
  });
  processor = await AutoProcessor.from_pretrained(MODEL_ID, { progress_callback });
  post({ type: 'ready', device: webgpu ? 'WebGPU' : 'WASM (CPU)' });
}

async function run(image: RawImage, task: string, maxTokens: number) {
  const prompts = (processor as any).construct_prompts(task);
  const inputs = await (processor as any)(image, prompts);
  const ids = await model!.generate({ ...inputs, max_new_tokens: maxTokens } as any);
  const text = (processor as any).batch_decode(ids, { skip_special_tokens: false })[0];
  return (processor as any).post_process_generation(text, task, image.size)[task];
}

interface Tile { data: Uint8ClampedArray; width: number; height: number; offsetY: number; scale: number }

self.onmessage = async (e: MessageEvent) => {
  const { type } = e.data;
  try {
    if (type === 'load') return await load();
    if (type === 'analyze') {
      await load();
      const { id, tiles, thumb, height } = e.data as { id: string; tiles: Tile[]; thumb: Tile; height: number };
      const t0 = performance.now();

      // Tall phone screenshots are read as a stack of square-ish tiles, because
      // Florence squashes every input to 768x768 and small text dies in the squash.
      const lines: { text: string; top: number; height: number }[] = [];
      for (const t of tiles) {
        const image = new RawImage(t.data, t.width, t.height, 4).rgb();
        const ocr = await run(image, '<OCR_WITH_REGION>', 256);
        const labels: string[] = ocr?.labels ?? [];
        const boxes: number[][] = ocr?.quad_boxes ?? [];
        labels.forEach((raw, i) => {
          const text = raw.replace(/<\/?s>|<pad>/g, '').trim();
          const ys = (boxes[i] ?? []).filter((_, j) => j % 2 === 1);
          if (!text || !ys.length) return;
          const top = Math.min(...ys), bottom = Math.max(...ys);
          // Back to original-image pixels so headlines() can compare across tiles.
          lines.push({ text, top: t.offsetY + top / t.scale, height: (bottom - top) / t.scale });
        });
      }

      // The caption only names screens with no usable title (photos, maps,
      // charts). Skipping it when OCR already found one saves a full generate.
      let caption = '';
      if (!headlines(lines, height).length) {
        const capImage = new RawImage(thumb.data, thumb.width, thumb.height, 4).rgb();
        caption = String((await run(capImage, '<CAPTION>', 40)) ?? '').trim();
      }
      post({ type: 'result', id, lines, caption, ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    post({ type: 'error', id: e.data?.id, message: err instanceof Error ? err.message : String(err) });
  }
};

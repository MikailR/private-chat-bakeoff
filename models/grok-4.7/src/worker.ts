import { env, pipeline, TextStreamer } from '@huggingface/transformers';
import { MODEL_ID, WASM_BINARY, WASM_MJS } from './model';
import type { ProgressDetail } from './types';

interface InitMessage {
  type: 'init';
  modelBase: string;
  wasmBase: string;
}

interface GenerateMessage {
  type: 'generate';
  id: string;
  prompt: string;
}

type InMessage = InitMessage | GenerateMessage;

type Generator = {
  tokenizer: ConstructorParameters<typeof TextStreamer>[0];
  (text: string, options: Record<string, unknown>): Promise<Array<{ generated_text: string }>>;
};

let generator: Generator | null = null;
let busy = false;

function post(message: Record<string, unknown>) {
  self.postMessage(message);
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function summarize(update: Record<string, unknown>): ProgressDetail {
  return {
    status: typeof update.status === 'string' ? update.status : '',
    file: typeof update.file === 'string' ? update.file : '',
    progress: typeof update.progress === 'number' ? update.progress : null,
    loaded: typeof update.loaded === 'number' ? update.loaded : null,
    total: typeof update.total === 'number' ? update.total : null,
  };
}

async function init(message: InitMessage) {
  // Weights and the WASM runtime are same-origin files. Remote hub loads stay off.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = message.modelBase;
  env.useBrowserCache = false;
  env.useWasmCache = false;

  const onnx = env.backends.onnx as {
    wasm?: {
      wasmPaths?: { mjs: string; wasm: string };
      numThreads?: number;
      proxy?: boolean;
    };
  };
  const wasm = onnx.wasm;
  if (!wasm) {
    throw new Error('The local ONNX runtime did not start.');
  }
  const base = message.wasmBase.endsWith('/') ? message.wasmBase : `${message.wasmBase}/`;
  wasm.wasmPaths = {
    mjs: `${base}${WASM_MJS}`,
    wasm: `${base}${WASM_BINARY}`,
  };
  wasm.numThreads = 1;
  wasm.proxy = false;

  const created = await pipeline('text2text-generation', MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
    local_files_only: true,
    progress_callback: (update) => {
      post({ type: 'progress', detail: summarize(update as Record<string, unknown>) });
    },
  });
  generator = created as Generator;
  post({ type: 'ready' });
}

async function generate(message: GenerateMessage) {
  if (!generator) throw new Error('The model is not loaded yet.');
  if (busy) throw new Error('The model is already writing a reply.');
  busy = true;
  let streamed = '';
  try {
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (chunk: string) => {
        streamed += chunk;
        post({ type: 'token', id: message.id, text: streamed });
      },
    });
    const output = await generator(message.prompt, {
      max_new_tokens: 48,
      do_sample: false,
      no_repeat_ngram_size: 3,
      streamer,
    });
    const text = output?.[0]?.generated_text ?? streamed;
    post({ type: 'done', id: message.id, text });
  } finally {
    busy = false;
  }
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  const run = message.type === 'init' ? init(message) : generate(message);
  run.catch((error: unknown) => {
    console.error(error);
    post({
      type: 'error',
      phase: message.type === 'init' ? 'init' : 'generate',
      id: message.type === 'generate' ? message.id : undefined,
      message: describe(error),
    });
  });
};

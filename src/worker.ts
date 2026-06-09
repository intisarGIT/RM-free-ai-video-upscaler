import WebSR from '@websr/websr';
import { WebGLUpscaler, WebGLBilinearUpscaler, WebGPUBilinearUpscaler } from './websr/webgl';

import type {
  WorkerRequestMessage,
  WorkerResponseMessage,
  InitData,
  NetworkData,
  Resolution
} from './types/worker-messages';

// Processors
import pipelineProcessor from './processors/pipeline-processor';
import mediabunnyProcessor from './processors/mediabunny-processor'; // Fallback if needed

// Worker state
let gpu: any | false = false;
let gl: any | false = false;
let backend: 'webgpu' | 'webgl' | null = null;
let websr: WebSR | WebGLUpscaler;
let bilinearUpscaler: WebGPUBilinearUpscaler | WebGLBilinearUpscaler | null = null;
let upscaled_canvas: OffscreenCanvas;
let original_canvas: OffscreenCanvas;
let resolution: Resolution;
let ctx: ImageBitmapRenderingContext | null;
let pauseLock: Promise<void> | null = null;
let resolvePause: (() => void) | null = null;

// Default weights
const weights = require('./weights/cnn-2x-m-rl.json');

/**
 * Check if WebGPU or WebGL2 is supported in this environment
 */
async function isSupported(): Promise<void> {
  // WebCodecs check
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
    postMessage({
      cmd: 'isSupported',
      data: { supported: false, backend: null, missingFeature: 'WebCodecs' }
    } satisfies WorkerResponseMessage);
    return;
  }

  // WebGPU check
  try {
    gpu = await WebSR.initWebGPU();
  } catch (e) {
    console.warn('WebGPU check failed:', e);
    gpu = false;
  }

  if (gpu !== false) {
    backend = 'webgpu';
    postMessage({
      cmd: 'isSupported',
      data: { supported: true, backend: 'webgpu' }
    } satisfies WorkerResponseMessage);
    return;
  }

  // WebGL2 check
  try {
    gl = WebGLUpscaler.initWebGL();
  } catch (e) {
    console.warn('WebGL2 check failed:', e);
    gl = false;
  }

  if (gl !== false) {
    backend = 'webgl';
    postMessage({
      cmd: 'isSupported',
      data: { supported: true, backend: 'webgl' }
    } satisfies WorkerResponseMessage);
    return;
  }

  postMessage({
    cmd: 'isSupported',
    data: { supported: false, backend: null, missingFeature: 'WebGPU or WebGL2 (with EXT_color_buffer_float)' }
  } satisfies WorkerResponseMessage);
}

/**
 * Initialize the worker with canvases and create WebSR instance
 */
async function init(config: InitData): Promise<void> {
  if (!gpu && !gl) {
    try {
      gpu = await WebSR.initWebGPU();
    } catch (e) {
      gpu = false;
    }
    if (gpu !== false) {
      backend = 'webgpu';
    } else {
      try {
        gl = WebGLUpscaler.initWebGL();
      } catch (e) {
        gl = false;
      }
      if (gl !== false) {
        backend = 'webgl';
      }
    }
  }

  if (bilinearUpscaler) {
    try {
      (bilinearUpscaler as any).destroy?.();
    } catch (e) {
      console.warn('Failed to destroy bilinear upscaler:', e);
    }
    bilinearUpscaler = null;
  }

  if (backend === 'webgpu') {
    websr = new WebSR({
      network_name: "anime4k/cnn-2x-m",
      weights,
      resolution: config.resolution,
      gpu: gpu,
      canvas: config.upscaled as any // OffscreenCanvas is valid but types may be strict
    });
    bilinearUpscaler = new WebGPUBilinearUpscaler(gpu);
  } else if (backend === 'webgl') {
    const localLargeWeights = require('./weights/cnn-2x-l-rl.json');
    websr = new WebGLUpscaler({
      network_name: "anime4k/cnn-2x-l",
      weights: localLargeWeights,
      resolution: config.resolution,
      gl: gl,
      canvas: config.upscaled
    });
    bilinearUpscaler = new WebGLBilinearUpscaler();
  } else {
    throw new Error('No supported WebGPU or WebGL2 backend found');
  }

  resolution = config.resolution;
  upscaled_canvas = config.upscaled;
  original_canvas = config.original;

  ctx = original_canvas.getContext('bitmaprenderer');

  let bitmap2: ImageBitmap;
  if (bilinearUpscaler) {
    bitmap2 = await bilinearUpscaler.upscale(
      config.bitmap,
      config.resolution.width * 2,
      config.resolution.height * 2
    );
  } else {
    bitmap2 = await createImageBitmap(config.bitmap, {
      resizeHeight: config.resolution.height * 2,
      resizeWidth: config.resolution.width * 2,
    });
  }

  await websr.render(config.bitmap as any);

  if (ctx) {
    ctx.transferFromImageBitmap(bitmap2);
  }
}

/**
 * Switch to a different AI upscaling network
 */
async function switchNetwork(name: string, weights: any, bitmap: ImageBitmap): Promise<void> {
  websr.switchNetwork(name as any, weights);

  await websr.render(bitmap as any);
}






// Processing functions moved to processors/

/**
 * Worker message handler with type-safe message routing
 */
self.onmessage = async function (event: MessageEvent<WorkerRequestMessage>) {
  if (!event.data.cmd) return;

  switch (event.data.cmd) {
    case 'init':
      await init(event.data.data);
      break;

    case 'isSupported':
      await isSupported();
      break;

    case 'pause':
      if (!pauseLock) {
        pauseLock = new Promise(resolve => { resolvePause = resolve; });
        postMessage({ cmd: 'paused' } satisfies WorkerResponseMessage);
      }
      break;

    case 'resume':
      if (pauseLock && resolvePause) {
        resolvePause();
        pauseLock = null;
        resolvePause = null;
        postMessage({ cmd: 'resumed' } satisfies WorkerResponseMessage);
      }
      break;
    
    case 'process':


      await pipelineProcessor({
        inputHandle: event.data.inputHandle,
        outputHandle: event.data.outputHandle,
        websr,
        upscaled_canvas,
        original_canvas,
        resolution,
        getPauseLock: () => pauseLock
      });

     // To use MediaBunny instead, uncomment above import and use:
 //    await mediabunnyProcessor({ inputHandle: event.data.inputHandle, outputHandle: event.data.outputHandle, websr, upscaled_canvas, original_canvas, resolution, getPauseLock: () => pauseLock });
      break;

    case 'network':
      await switchNetwork(
        event.data.data.name,
        event.data.data.weights,
        event.data.data.bitmap
      );
      break;
  }
};

/**
 * Web Worker for KTX2 transcoding
 * Runs libktx transcoding off the main thread for better performance
 */

import type {
  KtxModule,
  KtxApi,
  Ktx2TranscodeResult,
  WorkerInitMessage,
  WorkerTranscodeMessage,
  WorkerResponse,
} from '../loaders/ktx2-types';

let ktxModule: KtxModule | null = null;
let ktxApi: KtxApi | null = null;
let isInitialized = false;

/**
 * Create cwrap API wrappers for KTX C functions
 */
function createKtxApi(module: KtxModule): KtxApi {
  // Direct exported C functions — no cwrap dependency
  return {
    malloc: (size: number) => module._malloc(size),
    free: (ptr: number) => module._free(ptr),
    createFromMemory: (dataPtr: number, dataSize: number, flags: number, outPtr: number) =>
      module._ktxTexture2_CreateFromMemory(dataPtr, dataSize, flags, outPtr),
    destroy: (handle: number) => module._ktxTexture2_Destroy(handle),
    transcode: (handle: number, format: number, flags: number) =>
      module._ktxTexture2_TranscodeBasis(handle, format, flags),
    needsTranscoding: (handle: number) => module._ktxTexture2_NeedsTranscoding(handle),
    getData: (handle: number) => module._ktx_get_data(handle),
    getDataSize: (handle: number) => module._ktx_get_data_size(handle),
    getWidth: (handle: number) => module._ktx_get_base_width(handle),
    getHeight: (handle: number) => module._ktx_get_base_height(handle),
    getLevels: (handle: number) => module._ktx_get_num_levels(handle),
    getOffset: (handle: number, level: number, layer: number, face: number) =>
      module._ktx_get_image_offset(handle, level, layer, face),
    errorString: (code: number) => module.UTF8ToString(module._ktxErrorString(code)),
  };
}

/**
 * Initialize libktx module in worker
 */
async function initializeModule(libktxCode: string, wasmUrl: string): Promise<void> {
  try {
    // Remove import.meta and export statements
    let modifiedCode = libktxCode.replace(/import\.meta\.url/g, `"${wasmUrl}"`);
    modifiedCode = modifiedCode.replace(/import\.meta/g, `{url: "${wasmUrl}"}`);
    modifiedCode = modifiedCode.replace(/\bexport\s+default\s+/g, '');
    modifiedCode = modifiedCode.replace(/\bexport\s+\{[^}]*\}/g, '');
    modifiedCode = modifiedCode.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');

    // Execute to get factory function
    const wrappedCode = `
      (function() {
        ${modifiedCode}
        return typeof createKtxReadModule !== 'undefined' ? createKtxReadModule : (typeof LIBKTX !== 'undefined' ? LIBKTX : (typeof createKtxModule !== 'undefined' ? createKtxModule : null));
      })();
    `;

    const factory = (0, eval)(wrappedCode);

    if (!factory || typeof factory !== 'function') {
      throw new Error('Could not extract createKtxModule factory');
    }

    // Load WASM binary
    const wasmResponse = await fetch(wasmUrl);
    if (!wasmResponse.ok) {
      throw new Error(`Failed to fetch WASM: ${wasmResponse.status}`);
    }
    const wasmBinary = await wasmResponse.arrayBuffer();

    // Initialize module
    ktxModule = await factory({
      wasmBinary: wasmBinary,
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return wasmUrl;
        }
        return path;
      }
    });

    if (!ktxModule) {
      throw new Error('Failed to create KTX module');
    }

    // UTF8ToString polyfill — reads fresh view on each call (WASM memory can grow)
    if (!ktxModule.UTF8ToString) {
      (ktxModule as any).UTF8ToString = (ptr: number): string => {
        // HEAP8 is exported; create fresh Uint8Array each call to survive memory.grow()
        const heap = new Uint8Array((ktxModule as any).HEAP8.buffer);
        let s = '', i = ptr;
        while (heap[i]) s += String.fromCharCode(heap[i++]);
        return s;
      };
    }
    // NOTE: Do NOT cache HEAPU8 — WASM memory.grow() detaches the old ArrayBuffer.
    // Use getHeap() helper in transcodeMainThread instead.

    // Create API wrappers
    ktxApi = createKtxApi(ktxModule);
    isInitialized = true;

  } catch (error) {
    throw new Error(`Worker initialization failed: ${error}`);
  }
}

/**
 * Transcode mini-KTX2 to the requested GPU format
 */
function transcodeMainThread(miniKtx: Uint8Array, targetFormat: number): Ktx2TranscodeResult {
  if (!ktxModule || !ktxApi) {
    throw new Error('Worker not initialized');
  }

  const api = ktxApi;
  const ktx = ktxModule;
  // Always create fresh view — WASM memory.grow() invalidates previous ArrayBuffer
  const getHeap = (): Uint8Array => new Uint8Array((ktx as any).HEAP8.buffer);

  // Allocate memory for mini-KTX2 data
  const ptr = api.malloc(miniKtx.byteLength);
  if (!ptr) {
    throw new Error('Failed to allocate WASM memory');
  }

  try {
    // Copy miniKtx data to WASM heap
    getHeap().set(miniKtx, ptr);

    // Allocate pointer to receive texture pointer
    const outPtrPtr = api.malloc(4);
    if (!outPtrPtr) {
      api.free(ptr);
      throw new Error('Failed to allocate output pointer');
    }

    try {
      // Create texture from memory
      const rc = api.createFromMemory(ptr, miniKtx.byteLength, 0, outPtrPtr);

      if (rc !== 0) {
        const errorMsg = api.errorString ? api.errorString(rc) : `Error code ${rc}`;
        throw new Error(`ktxTexture2_CreateFromMemory failed: ${errorMsg}`);
      }

      // Read the texture pointer
      const texPtr = ktx.getValue(outPtrPtr, '*');
      api.free(outPtrPtr);

      if (!texPtr) {
        throw new Error('Texture pointer is null');
      }

      try {
        // Check if transcoding is needed
        const needsTranscode = api.needsTranscoding(texPtr);

        if (needsTranscode) {
          // Transcode to the format requested by the main thread
          const rcT = api.transcode(texPtr, targetFormat, 0);

          if (rcT !== 0) {
            const errorMsg = api.errorString ? api.errorString(rcT) : `Error code ${rcT}`;
            api.destroy(texPtr);
            throw new Error(`Transcoding failed: ${errorMsg}`);
          }
        }

        // Get texture data
        const dataPtr = api.getData(texPtr);
        const baseW = api.getWidth(texPtr);
        const baseH = api.getHeight(texPtr);
        const dataSize = api.getDataSize(texPtr);

        // Calculate expected size
        const expected = baseW * baseH * 4; // RGBA
        const total = Math.min(expected, dataSize);

        // Copy data from WASM heap
        const heap = getHeap();
        const rgbaData = new Uint8Array(heap.buffer, dataPtr, total);
        const dataCopy = new Uint8Array(rgbaData); // Make a copy

        // Cleanup texture
        api.destroy(texPtr);

        return {
          width: baseW,
          height: baseH,
          data: dataCopy,
        };

      } catch (innerError) {
        api.destroy(texPtr);
        throw innerError;
      }

    } catch (outPtrError) {
      throw outPtrError;
    }

  } catch (error) {
    api.free(ptr);
    throw error;
  } finally {
    api.free(ptr);
  }
}

/**
 * Message handler
 */
self.onmessage = async (e: MessageEvent) => {
  const message = e.data;

  if (message.type === 'init') {
    const initMsg = message as WorkerInitMessage;
    try {
      await initializeModule(initMsg.data.libktxCode, initMsg.data.wasmUrl);

      const response: WorkerResponse = {
        type: 'init',
        success: true,
      };
      self.postMessage(response);

    } catch (error: any) {
      const response: WorkerResponse = {
        type: 'init',
        success: false,
        error: error.message,
        stack: error.stack,
      };
      self.postMessage(response);
    }

  } else if (message.type === 'transcode') {
    const transcodeMsg = message as WorkerTranscodeMessage;
    try {
      if (!isInitialized) {
        throw new Error('Worker not initialized');
      }

      const miniKtx = new Uint8Array(transcodeMsg.data.miniKtx);
      const result = transcodeMainThread(miniKtx, transcodeMsg.data.targetFormat ?? 13);

      const response: WorkerResponse = {
        type: 'transcode',
        success: true,
        messageId: transcodeMsg.messageId,
        width: result.width,
        height: result.height,
        data: result.data,
        heapStats: result.heapStats,
      };

      // Transfer ArrayBuffer to avoid copying
      self.postMessage(response, { transfer: [response.data!.buffer] } as any);

    } catch (error: any) {
      const response: WorkerResponse = {
        type: 'transcode',
        success: false,
        messageId: transcodeMsg.messageId,
        error: error.message,
        stack: error.stack,
      };
      self.postMessage(response);
    }
  }
};
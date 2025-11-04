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
} from '../ktx2-loader/types';

let ktxModule: KtxModule | null = null;
let ktxApi: KtxApi | null = null;
let isInitialized = false;

/**
 * Create cwrap API wrappers for KTX C functions
 */
function createKtxApi(module: KtxModule): KtxApi {
  return {
    malloc: module.cwrap('malloc', 'number', ['number']),
    free: module.cwrap('free', null, ['number']),
    createFromMemory: module.cwrap('ktxTexture2_CreateFromMemory', 'number', ['number', 'number', 'number', 'number']),
    destroy: module.cwrap('ktxTexture2_Destroy', null, ['number']),
    transcode: module.cwrap('ktxTexture2_TranscodeBasis', 'number', ['number', 'number', 'number']),
    needsTranscoding: module.cwrap('ktxTexture2_NeedsTranscoding', 'number', ['number']),
    getData: module.cwrap('ktx_get_data', 'number', ['number']),
    getDataSize: module.cwrap('ktx_get_data_size', 'number', ['number']),
    getWidth: module.cwrap('ktx_get_base_width', 'number', ['number']),
    getHeight: module.cwrap('ktx_get_base_height', 'number', ['number']),
    getLevels: module.cwrap('ktx_get_num_levels', 'number', ['number']),
    getOffset: module.cwrap('ktx_get_image_offset', 'number', ['number', 'number', 'number', 'number']),
    errorString: module.cwrap('ktxErrorString', 'string', ['number']),
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
        return typeof LIBKTX !== 'undefined' ? LIBKTX : (typeof createKtxModule !== 'undefined' ? createKtxModule : null);
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

    // Create API wrappers
    ktxApi = createKtxApi(ktxModule);
    isInitialized = true;

  } catch (error) {
    throw new Error(`Worker initialization failed: ${error}`);
  }
}

/**
 * Transcode mini-KTX2 to RGBA
 */
function transcodeMainThread(miniKtx: Uint8Array): Ktx2TranscodeResult {
  if (!ktxModule || !ktxApi) {
    throw new Error('Worker not initialized');
  }

  const heapBefore = ktxModule.HEAPU8.length;
  const api = ktxApi;
  const ktx = ktxModule;

  // Allocate memory for mini-KTX2 data
  const ptr = api.malloc(miniKtx.byteLength);
  if (!ptr) {
    throw new Error('Failed to allocate WASM memory');
  }

  try {
    // Copy miniKtx data to WASM heap
    ktx.HEAPU8.set(miniKtx, ptr);

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
          // Get RGBA32 format constant (value: 13)
          const RGBA32_FORMAT = typeof ktxModule.TranscodeTarget === 'function'
            ? 13
            : (ktxModule.TranscodeTarget.RGBA32?.value ?? 13);

          // Transcode to RGBA32
          const rcT = api.transcode(texPtr, RGBA32_FORMAT, 0);

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
        const rgbaData = new Uint8Array(ktx.HEAPU8.buffer, dataPtr, total);
        const dataCopy = new Uint8Array(rgbaData); // Make a copy

        // Cleanup texture
        api.destroy(texPtr);

        const heapAfter = ktx.HEAPU8.length;
        const heapFreed = Math.max(0, heapBefore - heapAfter);

        return {
          width: baseW,
          height: baseH,
          data: dataCopy,
          heapStats: {
            before: heapBefore,
            after: heapAfter,
            freed: heapFreed,
          },
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
      const result = transcodeMainThread(miniKtx);

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

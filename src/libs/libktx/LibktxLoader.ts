/**
 * LibktxLoader - Singleton for loading libktx module from external URLs
 *
 * libktx.mjs and libktx.wasm MUST be hosted externally (e.g. GitHub, CDN)
 * URLs are REQUIRED - no Asset Registry fallback.
 */

import type * as pc from 'playcanvas';
import type { KtxModule } from '../../loaders/ktx2-types';

export class LibktxLoader {
  private static instance: LibktxLoader | null = null;
  private ktxModule: KtxModule | null = null;
  private initPromise: Promise<KtxModule> | null = null;
  private verbose = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): LibktxLoader {
    if (!LibktxLoader.instance) {
      LibktxLoader.instance = new LibktxLoader();
    }
    return LibktxLoader.instance;
  }

  /**
   * Initialize libktx module from external URLs
   * @param app PlayCanvas application (unused, kept for API compatibility)
   * @param verbose Enable verbose logging
   * @param libktxMjsUrl REQUIRED: External URL for libktx.mjs
   * @param libktxWasmUrl REQUIRED: External URL for libktx.wasm
   * @returns Initialized KTX module
   */
  public async initialize(
    app: pc.Application,
    verbose = false,
    libktxMjsUrl: string,
    libktxWasmUrl: string
  ): Promise<KtxModule> {
    this.verbose = verbose;

    // Validate required URLs
    if (!libktxMjsUrl || !libktxWasmUrl) {
      throw new Error(
        '[LibktxLoader] External URLs are REQUIRED!\n\n' +
        'Please provide:\n' +
        '  - libktxMjsUrl: URL to libktx.mjs\n' +
        '  - libktxWasmUrl: URL to libktx.wasm\n\n' +
        'Example:\n' +
        '  libktxMjsUrl: "https://raw.githubusercontent.com/user/repo/main/libktx.mjs"\n' +
        '  libktxWasmUrl: "https://raw.githubusercontent.com/user/repo/main/libktx.wasm"'
      );
    }

    // Return cached module if already initialized
    if (this.ktxModule) {
      if (this.verbose) {
        console.log('[LibktxLoader] Using cached KTX module');
      }
      return this.ktxModule;
    }

    // Return pending promise if initialization is in progress
    if (this.initPromise) {
      if (this.verbose) {
        console.log('[LibktxLoader] Initialization already in progress...');
      }
      return this.initPromise;
    }

    // Start initialization
    this.initPromise = this._initializeInternal(libktxMjsUrl, libktxWasmUrl);
    return this.initPromise;
  }

  private async _initializeInternal(
    mjsUrl: string,
    wasmUrl: string
  ): Promise<KtxModule> {
    try {
      if (this.verbose) {
        console.log('[LibktxLoader] Starting initialization...');
        console.log('  - libktx.mjs:', mjsUrl);
        console.log('  - libktx.wasm:', wasmUrl);
      }

      // Step 1: Load JS code as text
      const t0 = performance.now();
      const jsCode = await this._loadJsAsText(mjsUrl);
      const t1 = performance.now();
      if (this.verbose) {
        console.log(`[LibktxLoader] libktx.mjs fetched (${(t1 - t0).toFixed(0)}ms, ${(jsCode.length / 1024).toFixed(0)} KB)`);
      }

      // Step 2: Execute JS code to get factory function
      const factory = this._executeJsCode(jsCode, mjsUrl);

      // Step 3: Load WASM binary
      const t2 = performance.now();
      const wasmBinary = await this._loadWasmBinary(wasmUrl);
      const t3 = performance.now();
      if (this.verbose) {
        console.log(`[LibktxLoader] libktx.wasm fetched (${(t3 - t2).toFixed(0)}ms, ${(wasmBinary.byteLength / 1024).toFixed(0)} KB)`);
      }

      // Step 4: Initialize WASM module
      const t4 = performance.now();
      const module = await this._initializeWasmModule(factory, wasmBinary, wasmUrl);
      const t5 = performance.now();
      if (this.verbose) {
        console.log(`[LibktxLoader] WASM compiled (${(t5 - t4).toFixed(0)}ms)`);
      }

      this.ktxModule = module;

      if (this.verbose) {
        console.log('[LibktxLoader] Initialization complete');
      }

      return module;

    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  /**
   * Load JavaScript code as text via fetch
   */
  private async _loadJsAsText(url: string): Promise<string> {
    if (this.verbose) {
      console.log('[LibktxLoader] Fetching JS code from:', url);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `[LibktxLoader] Failed to fetch libktx.mjs: ${response.status} ${response.statusText}\n` +
        `URL: ${url}`
      );
    }

    const code = await response.text();

    if (this.verbose) {
      console.log('[LibktxLoader] JS code loaded:', code.length, 'bytes');
    }

    return code;
  }

  /**
   * Execute JS code and extract the createKtxModule factory function
   */
  private _executeJsCode(code: string, moduleUrl: string): (config?: any) => Promise<KtxModule> {
    if (this.verbose) {
      console.log('[LibktxLoader] Executing libktx.mjs code...');
    }

    try {
      // Replace import.meta.url with actual URL
      let modifiedCode = code.replace(/import\.meta\.url/g, `"${moduleUrl}"`);
      modifiedCode = modifiedCode.replace(/import\.meta/g, `{url: "${moduleUrl}"}`);

      // Remove export statements
      modifiedCode = modifiedCode.replace(/\bexport\s+default\s+/g, '');
      modifiedCode = modifiedCode.replace(/\bexport\s+\{[^}]*\}/g, '');
      modifiedCode = modifiedCode.replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ');

      // Execute and return factory
      const wrappedCode = `
        (function() {
          ${modifiedCode}
          return typeof createKtxReadModule !== 'undefined' ? createKtxReadModule : (typeof LIBKTX !== 'undefined' ? LIBKTX : (typeof createKtxModule !== 'undefined' ? createKtxModule : null));
        })();
      `;

      const factory = (0, eval)(wrappedCode);

      if (!factory || typeof factory !== 'function') {
        throw new Error('[LibktxLoader] Could not extract createKtxModule factory from libktx.mjs');
      }

      if (this.verbose) {
        console.log('[LibktxLoader] Factory function extracted successfully');
      }

      return factory;

    } catch (error) {
      throw new Error(`[LibktxLoader] Failed to execute libktx.mjs: ${error}`);
    }
  }

  /**
   * Load WASM binary via fetch
   */
  private async _loadWasmBinary(url: string): Promise<ArrayBuffer> {
    if (this.verbose) {
      console.log('[LibktxLoader] Fetching WASM binary from:', url);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `[LibktxLoader] Failed to fetch libktx.wasm: ${response.status} ${response.statusText}\n` +
        `URL: ${url}`
      );
    }

    const binary = await response.arrayBuffer();

    if (this.verbose) {
      console.log('[LibktxLoader] WASM binary loaded:', binary.byteLength, 'bytes');
    }

    return binary;
  }

  /**
   * Initialize WASM module with factory and binary
   */
  private async _initializeWasmModule(
    factory: (config?: any) => Promise<KtxModule>,
    wasmBinary: ArrayBuffer,
    wasmUrl: string
  ): Promise<KtxModule> {
    if (this.verbose) {
      console.log('[LibktxLoader] Initializing WASM module...');
    }

    try {
      const module = await factory({
        wasmBinary: wasmBinary,
        locateFile: (path: string) => {
          if (path.endsWith('.wasm')) {
            return wasmUrl;
          }
          return path;
        }
      });

      // Patch HEAPU8/UTF8ToString if not exported (MODULARIZE mode)
      // HEAP8 (Int8Array) is the only exported heap — derive others from its buffer
      if (!module.HEAPU8) {
        const heap8 = (module as any).HEAP8 as Int8Array | undefined;
        if (!heap8) {
          throw new Error('[LibktxLoader] HEAP8 not exported — cannot build HEAPU8');
        }
        const buf = heap8.buffer;
        (module as any).HEAPU8  = new Uint8Array(buf);
        (module as any).HEAPU32 = new Uint32Array(buf);
      }

      if (!module.UTF8ToString) {
        (module as any).UTF8ToString = (ptr: number): string => {
          let s = '';
          const heap = (module as any).HEAPU8 as Uint8Array;
          let i = ptr;
          while (heap[i]) s += String.fromCharCode(heap[i++]);
          return s;
        };
      }

      if (this.verbose) {
        console.log('[LibktxLoader] WASM module initialized successfully');
      }

      return module;

    } catch (error) {
      throw new Error(
        `[LibktxLoader] Failed to initialize WASM module: ${error}`
      );
    }
  }

  /**
   * Get the initialized module (returns null if not initialized)
   */
  public getModule(): KtxModule | null {
    return this.ktxModule;
  }

  /**
   * Check if module is initialized
   */
  public isInitialized(): boolean {
    return this.ktxModule !== null;
  }

  /**
   * Reset the loader (useful for testing)
   */
  public reset(): void {
    this.ktxModule = null;
    this.initPromise = null;
    if (this.verbose) {
      console.log('[LibktxLoader] Reset complete');
    }
  }
}
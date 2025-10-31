/**
 * KTX2 Progressive Loader Script (ESM Standalone)
 *
 * This script dynamically loads the Ktx2ProgressiveLoader at runtime
 * to avoid import path issues in PlayCanvas Editor.
 */

import { Script } from 'playcanvas';

export class Ktx2LoaderScript extends Script {
  static scriptName = 'ktx2Loader';

  /** @attribute */
  ktxUrl = '';

  /** @attribute */
  progressive = true;

  /** @attribute */
  isSrgb = false;

  /** @attribute */
  verbose = true;

  /** @attribute */
  enableCache = true;

  /** @attribute */
  useWorker = false;

  /** @attribute */
  adaptiveLoading = false;

  /**
   * @attribute
   * @range [0, 1000]
   */
  stepDelayMs = 150;

  loader = null;
  texture = null;

  async initialize() {
    if (this.verbose) {
      console.log('[KTX2] Script initializing...');
    }

    try {
      // Dynamic import of the loader module
      const loaderModule = await import('./ktx2-loader/Ktx2ProgressiveLoader.js');
      const Ktx2ProgressiveLoader = loaderModule.Ktx2ProgressiveLoader;

      // Create loader instance
      this.loader = new Ktx2ProgressiveLoader(this.app, {
        ktxUrl: this.ktxUrl,
        progressive: this.progressive,
        isSrgb: this.isSrgb,
        verbose: this.verbose,
        enableCache: this.enableCache,
        useWorker: this.useWorker,
        adaptiveLoading: this.adaptiveLoading,
        stepDelayMs: this.stepDelayMs,
      });

      // Find libktx assets
      const libktxMjsAsset = this.app.assets.find('libktx.mjs', 'script');
      const libktxWasmAsset = this.app.assets.find('libktx.wasm', 'binary');

      if (!libktxMjsAsset || !libktxWasmAsset) {
        throw new Error(
          'libktx assets not found! Please upload libktx.mjs and libktx.wasm to PlayCanvas Assets.'
        );
      }

      const libktxMjsUrl = libktxMjsAsset.getFileUrl();
      const libktxWasmUrl = libktxWasmAsset.getFileUrl();

      if (this.verbose) {
        console.log('[KTX2] Initializing loader...');
      }

      // Initialize loader
      await this.loader.initialize(libktxMjsUrl, libktxWasmUrl);

      if (this.verbose) {
        console.log('[KTX2] Loader initialized successfully');
      }

      // Load texture progressively
      this.texture = await this.loader.loadToEntity(this.entity, {
        onProgress: (level, total, info) => {
          if (this.verbose) {
            console.log(
              `[KTX2] Progress: ${level}/${total} ` +
              `(${info.width}x${info.height}, ${info.cached ? 'cached' : 'network'})`
            );
          }

          // Fire event for UI updates
          this.app.fire('ktx2:progress', {
            level,
            total,
            percent: (level / total) * 100,
            info,
          });
        },

        onComplete: (stats) => {
          if (this.verbose) {
            console.log('[KTX2] Loading complete!', stats);
          }

          this.app.fire('ktx2:complete', stats);
        },
      });

      if (this.verbose) {
        console.log('[KTX2] Texture loaded successfully');
      }
    } catch (error) {
      console.error('[KTX2] Error:', error);
      this.app.fire('ktx2:error', error);
    }
  }

  update(dt) {
    // Optional: Add runtime logic here
  }

  onDestroy() {
    // Cleanup resources
    if (this.loader) {
      this.loader.dispose();
      this.loader = null;
    }

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    if (this.verbose) {
      console.log('[KTX2] Script destroyed');
    }
  }
}

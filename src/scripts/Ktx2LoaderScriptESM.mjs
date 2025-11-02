/**
 * KTX2 Progressive Loader Script for PlayCanvas 2.x ESM
 *
 * This script dynamically loads the Ktx2ProgressiveLoader module.
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
      // Use ../ to go up from scripts/ folder
      const loaderModule = await import('../ktx2-loader/Ktx2ProgressiveLoader.mjs');
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
      if (this.verbose) {
        console.log('[KTX2] Searching for libktx assets...');
      }

      const libktxJsAsset = this.app.assets.find('libktx.mjs', 'script');
      // PlayCanvas определяет .wasm файлы как тип 'wasm', а не 'binary'
      let libktxWasmAsset = this.app.assets.find('libktx.wasm', 'wasm');

      // Fallback: попробовать найти как binary на случай если тип изменён вручную
      if (!libktxWasmAsset) {
        libktxWasmAsset = this.app.assets.find('libktx.wasm', 'binary');
      }

      if (!libktxJsAsset || !libktxWasmAsset) {
        console.error('[KTX2] libktx.mjs found:', !!libktxJsAsset);
        console.error('[KTX2] libktx.wasm found:', !!libktxWasmAsset);
        console.error('[KTX2] Available asset types:', [...new Set(this.app.assets.list().map(a => a.type))]);
        throw new Error(
          'libktx assets not found! Please upload libktx.mjs and libktx.wasm to PlayCanvas Assets.'
        );
      }

      const libktxJsUrl = libktxJsAsset.getFileUrl();
      const libktxWasmUrl = libktxWasmAsset.getFileUrl();

      if (this.verbose) {
        console.log('[KTX2] Asset URLs:');
        console.log('  - libktx.mjs:', libktxJsUrl);
        console.log('  - libktx.wasm:', libktxWasmUrl);
        console.log('[KTX2] Initializing loader...');
      }

      // Initialize loader
      await this.loader.initialize(libktxJsUrl, libktxWasmUrl);

      if (this.verbose) {
        console.log('[KTX2] Loader initialized successfully');
      }

      // Load texture progressively
      this.texture = await this.loader.loadToEntity(this.entity, {
        onProgress: (level, total, info) => {
          if (this.verbose) {
            console.log(`[KTX2] Progress: ${level}/${total}`, info);
          }

          this.app.fire('ktx2:progress', {
            level,
            total,
            percent: (level / total) * 100,
            info,
          });
        },

        onComplete: (stats) => {
          if (this.verbose) {
            console.log('[KTX2] Complete!', stats);
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
    // Runtime logic here if needed
  }

  onDestroy() {
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

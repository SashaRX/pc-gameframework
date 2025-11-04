/**
 * PlayCanvas ESM Script for KTX2 Progressive Loader
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';
import { Ktx2ProgressiveLoader } from '../ktx2-loader/Ktx2ProgressiveLoader';

// Script class exists at runtime but not exported in types
const Script = (pcRuntime as any).Script;

export class Ktx2LoaderScript extends Script {
  static scriptName = 'ktx2Loader';

  declare app: pc.Application;
  declare entity: pc.Entity;

  /**
   * @attribute
   */
  ktxUrl = '';

  /**
   * @attribute
   */
  libktxMjsUrl = '';

  /**
   * @attribute
   */
  libktxWasmUrl = '';

  /**
   * @attribute
   */
  progressive = true;

  /**
   * @attribute
   */
  isSrgb = false;

  /**
   * @attribute
   */
  verbose = true;

  /**
   * @attribute
   */
  enableCache = true;

  /**
   * @attribute
   */
  useWorker = false;

  /**
   * @attribute
   */
  adaptiveLoading = false;

  /**
   * @attribute
   * @range [0, 1000]
   */
  stepDelayMs = 150;

  /**
   * @attribute
   */
  adaptiveThrottling = false;

  /**
   * @attribute
   * @range [30, 120]
   */
  targetFps = 60;

  /**
   * @attribute
   * @range [0, 1000]
   */
  minStepDelayMs = 0;

  /**
   * @attribute
   * @range [0, 2000]
   */
  maxStepDelayMs = 500;

  private loader: Ktx2ProgressiveLoader | null = null;
  private texture: any = null;

  async initialize() {
    if (this.verbose) {
      console.log('[KTX2] Script initializing...');
      console.log('[KTX2] Script attributes:');
      console.log('  - ktxUrl:', this.ktxUrl);
      console.log('  - libktxMjsUrl:', this.libktxMjsUrl);
      console.log('  - libktxWasmUrl:', this.libktxWasmUrl);
      console.log('  - progressive:', this.progressive);
      console.log('  - isSrgb:', this.isSrgb);
      console.log('  - verbose:', this.verbose);
      console.log('  - enableCache:', this.enableCache);
      console.log('  - useWorker:', this.useWorker);
      console.log('  - adaptiveLoading:', this.adaptiveLoading);
      console.log('  - stepDelayMs:', this.stepDelayMs);
      console.log('  - adaptiveThrottling:', this.adaptiveThrottling);
      console.log('  - targetFps:', this.targetFps);
      console.log('  - minStepDelayMs:', this.minStepDelayMs);
      console.log('  - maxStepDelayMs:', this.maxStepDelayMs);
    }

    try {
      // Создаём loader с внешними URL для libktx файлов
      this.loader = new Ktx2ProgressiveLoader(this.app as any, {
        ktxUrl: this.ktxUrl,
        libktxModuleUrl: this.libktxMjsUrl || undefined,
        libktxWasmUrl: this.libktxWasmUrl || undefined,
        progressive: this.progressive,
        isSrgb: this.isSrgb,
        verbose: this.verbose,
        enableCache: this.enableCache,
        useWorker: this.useWorker,
        adaptiveLoading: this.adaptiveLoading,
        stepDelayMs: this.stepDelayMs,
        adaptiveThrottling: this.adaptiveThrottling,
        targetFps: this.targetFps,
        minStepDelayMs: this.minStepDelayMs,
        maxStepDelayMs: this.maxStepDelayMs,
      });

      // Initialize loader
      await this.loader.initialize();

      if (this.verbose) {
        console.log('[KTX2] Loader initialized successfully');
      }

      // Загрузка текстуры
      this.texture = await this.loader.loadToEntity(this.entity, {
        onProgress: (level: number, total: number, info: any) => {
          if (this.verbose) {
            console.log(`[Ktx2LoaderScript] Progress: ${level}/${total}`, info);
          }

          // Можно отправить event для UI
          this.app.fire('ktx2:progress', {
            level,
            total,
            percent: (level / total) * 100,
            info,
          });
        },

        onComplete: (stats: any) => {
          if (this.verbose) {
            console.log('[Ktx2LoaderScript] Complete!', stats);
          }

          this.app.fire('ktx2:complete', stats);
        },
      });

      if (this.verbose) {
        console.log('[Ktx2LoaderScript] Texture loaded successfully');
      }

    } catch (error) {
      console.error('[Ktx2LoaderScript] Error:', error);
      this.app.fire('ktx2:error', error);
    }
  }

  update(dt: number) {
    // Можно добавить runtime logic здесь
  }

  onDestroy() {
    // Очистка ресурсов
    if (this.loader) {
      this.loader.destroy();
      this.loader = null;
    }

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    if (this.verbose) {
      console.log('[Ktx2LoaderScript] Destroyed');
    }
  }
}

/**
 * TextureLoader - KTX2 texture loader for streaming system
 *
 * Wrapper around Ktx2ProgressiveLoader for integration with StreamingManager
 */

import type * as pc from 'playcanvas';
import { Ktx2ProgressiveLoader } from '../../loaders/Ktx2ProgressiveLoader';
import { AssetManifest } from '../AssetManifest';
import { CacheManager } from '../CacheManager';

export interface LoadedTexture {
  id: string;
  texture: pc.Texture;
  loader: Ktx2ProgressiveLoader;
  width: number;
  height: number;
}

export interface TextureLoaderConfig {
  libktxModuleUrl: string;
  libktxWasmUrl: string;
  maxConcurrent: number;
  debug: boolean;
}

export class TextureLoader {
  private app: pc.Application;
  private manifest: AssetManifest;
  private cache: CacheManager;
  private config: TextureLoaderConfig;

  private loadingPromises = new Map<string, Promise<LoadedTexture>>();
  private loadedTextures = new Map<string, LoadedTexture>();
  private activeLoaders = new Set<string>();

  constructor(app: pc.Application, config: TextureLoaderConfig) {
    this.app = app;
    this.manifest = AssetManifest.getInstance();
    this.cache = CacheManager.getInstance();
    this.config = config;
  }

  private log(...args: any[]): void {
    if (this.config.debug) {
      console.log('[TextureLoader]', ...args);
    }
  }

  /**
   * Load texture by ID
   */
  async load(textureId: string, startLevel?: number): Promise<LoadedTexture> {
    // Already loaded?
    const existing = this.loadedTextures.get(textureId);
    if (existing) {
      this.log(`Using cached texture: ${textureId}`);
      return existing;
    }

    // Already loading?
    const loadingPromise = this.loadingPromises.get(textureId);
    if (loadingPromise) {
      return loadingPromise;
    }

    // Check concurrency
    while (this.activeLoaders.size >= this.config.maxConcurrent) {
      await this.waitForSlot();
    }

    // Start loading
    this.activeLoaders.add(textureId);
    const promise = this.doLoad(textureId, startLevel);
    this.loadingPromises.set(textureId, promise);

    try {
      const result = await promise;
      this.loadedTextures.set(textureId, result);
      return result;
    } finally {
      this.activeLoaders.delete(textureId);
      this.loadingPromises.delete(textureId);
    }
  }

  private async waitForSlot(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  private async doLoad(textureId: string, startLevel?: number): Promise<LoadedTexture> {
    const url = this.manifest.getTextureUrl(textureId);
    if (!url) {
      throw new Error(`[TextureLoader] Texture not found in manifest: ${textureId}`);
    }

    this.log(`Loading texture: ${textureId} from ${url}`);

    // Create KTX2 loader
    const loader = new Ktx2ProgressiveLoader(this.app, {
      ktxUrl: url,
      libktxModuleUrl: this.config.libktxModuleUrl,
      libktxWasmUrl: this.config.libktxWasmUrl,
      verbose: this.config.debug,
      useWorker: true,
      progressive: true,
      adaptiveLoading: true,
    });

    // Initialize loader
    await loader.initialize();

    // Create a temporary entity to load texture to
    const tempEntity = new (this.app.root.constructor as any)('temp_' + textureId) as pc.Entity;
    tempEntity.addComponent('render', { type: 'box' });

    // Load texture
    const texture = await loader.loadToEntity(tempEntity);

    if (!texture) {
      tempEntity.destroy();
      throw new Error(`[TextureLoader] Failed to load texture: ${textureId}`);
    }

    // Remove temp entity but keep texture
    tempEntity.destroy();

    this.log(`Texture loaded: ${textureId}`, {
      width: texture.width,
      height: texture.height,
    });

    return {
      id: textureId,
      texture,
      loader,
      width: texture.width,
      height: texture.height,
    };
  }

  /**
   * Check if texture is loaded
   */
  isLoaded(textureId: string): boolean {
    return this.loadedTextures.has(textureId);
  }

  /**
   * Get loaded texture
   */
  getLoaded(textureId: string): LoadedTexture | null {
    return this.loadedTextures.get(textureId) || null;
  }

  /**
   * Get texture object
   */
  getTexture(textureId: string): pc.Texture | null {
    return this.loadedTextures.get(textureId)?.texture || null;
  }

  /**
   * Unload texture
   */
  unload(textureId: string): void {
    const loaded = this.loadedTextures.get(textureId);
    if (loaded) {
      loaded.loader.destroy();
      loaded.texture.destroy();
      this.loadedTextures.delete(textureId);
      this.log(`Unloaded texture: ${textureId}`);
    }
  }

  /**
   * Get total memory usage (estimate)
   */
  getMemoryUsage(): number {
    let total = 0;
    for (const loaded of this.loadedTextures.values()) {
      // BC7 = 1 byte per pixel
      total += loaded.width * loaded.height;
    }
    return total;
  }

  /**
   * Get stats
   */
  getStats(): { loaded: number; loading: number; memoryMB: number } {
    return {
      loaded: this.loadedTextures.size,
      loading: this.loadingPromises.size,
      memoryMB: this.getMemoryUsage() / (1024 * 1024),
    };
  }

  /**
   * Destroy all
   */
  destroy(): void {
    for (const loaded of this.loadedTextures.values()) {
      loaded.loader.destroy();
      loaded.texture.destroy();
    }
    this.loadedTextures.clear();
    this.loadingPromises.clear();
    this.activeLoaders.clear();
  }
}

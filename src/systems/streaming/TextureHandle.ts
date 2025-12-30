/**
 * TextureHandle - Wrapper for a single streaming texture
 * Manages loading, state, and priority for one texture
 */

import type * as pc from 'playcanvas';
import { Ktx2ProgressiveLoader } from '../../loaders/Ktx2ProgressiveLoader';
import type {
  TextureCategory,
  TextureState,
  TextureMetadata,
  TextureRegistration,
  PriorityContext,
  PriorityResult,
} from './types';

export class TextureHandle {
  // Metadata
  public readonly id: string;
  public readonly url: string;
  public readonly category: TextureCategory;
  public readonly entity: pc.Entity;

  // State
  private _state: TextureState = 'unloaded';
  private _priority: number = 0;
  private _currentLod: number = Infinity;

  // Configuration
  public readonly minLod: number;
  public readonly maxLod: number;
  public targetLod: number;
  public userPriority: number;

  // Loader
  private loader: Ktx2ProgressiveLoader | null = null;
  private texture: pc.Texture | null = null;

  // Tracking
  private memoryUsage: number = 0;
  private lastUsed: number = Date.now();
  private loadStartTime?: number;
  private loadEndTime?: number;
  private error?: Error;
  private abortController?: AbortController;

  // App reference
  private app: pc.Application;
  private loaderConfig: any;

  constructor(app: pc.Application, registration: TextureRegistration) {
    this.app = app;
    this.id = registration.id;
    this.url = registration.url;
    this.category = registration.category;
    this.entity = registration.entity;

    this.minLod = registration.minLod ?? 7;
    this.maxLod = registration.maxLod ?? 0;
    this.targetLod = registration.targetLod ?? this.minLod;
    this.userPriority = registration.userPriority ?? 1.0;

    this.loaderConfig = registration.loaderConfig ?? {};
  }

  // =========================================================================
  // State Management
  // =========================================================================

  get state(): TextureState {
    return this._state;
  }

  private setState(newState: TextureState): void {
    if (this._state !== newState) {
      this._state = newState;
      // Could emit event here if needed
    }
  }

  get priority(): number {
    return this._priority;
  }

  get currentLod(): number {
    return this._currentLod;
  }

  get isLoaded(): boolean {
    return this._state === 'loaded' || this._state === 'partial';
  }

  get isLoading(): boolean {
    return this._state === 'loading' || this._state === 'queued';
  }

  get canEvict(): boolean {
    return this.isLoaded && this.category !== 'persistent';
  }

  // =========================================================================
  // Priority Calculation
  // =========================================================================

  /**
   * Calculate priority based on distance to camera
   */
  calculatePriority(context: PriorityContext): PriorityResult {
    const entityPos = this.entity.getPosition();
    const distance = entityPos.distance(context.cameraPosition);

    // Distance factor: 1 / (1 + distance * 0.1)
    // Close objects = high factor, far objects = low factor
    const distanceFactor = 1 / (1 + distance * 0.1);

    // Category weight
    const categoryWeight = context.categoryWeights[this.category];

    // User weight (0-2, default 1)
    const userWeight = this.userPriority;

    // Final priority
    const priority = distanceFactor * categoryWeight * userWeight * context.distanceWeight;

    this._priority = priority;

    return {
      priority,
      distance,
      distanceFactor,
      categoryWeight,
      userWeight,
    };
  }

  /**
   * Update priority
   */
  setPriority(priority: number): void {
    this._priority = priority;
  }

  /**
   * Set user priority override
   */
  setUserPriority(priority: number): void {
    this.userPriority = Math.max(0, Math.min(2, priority));
  }

  // =========================================================================
  // Loading
  // =========================================================================

  /**
   * Start loading texture
   */
  async load(): Promise<void> {
    if (this.isLoaded || this.isLoading) {
      return;
    }

    this.setState('loading');
    this.loadStartTime = Date.now();
    this.abortController = new AbortController();

    try {
      // Create loader
      this.loader = new Ktx2ProgressiveLoader(this.app as any, {
        ktxUrl: this.url,
        progressive: true,
        enableCache: true,
        logLevel: 1, // errors only
        ...this.loaderConfig,
      });

      await this.loader.initialize();

      // Load to entity
      this.texture = await this.loader.loadToEntity(this.entity, {
        onProgress: (level: number, total: number, info: any) => {
          this._currentLod = level;
          this.memoryUsage = this.estimateMemoryUsage();

          // Update state to partial if not at target LOD yet
          if (level > this.targetLod) {
            this.setState('partial');
          } else {
            this.setState('loaded');
          }
        },
      });

      this.loadEndTime = Date.now();
      this.setState('loaded');
      this.lastUsed = Date.now();
      this.memoryUsage = this.estimateMemoryUsage();

    } catch (err: any) {
      this.error = err;
      this.setState('error');
      console.error(`[TextureHandle] Failed to load ${this.id}:`, err);
    }
  }

  /**
   * Cancel loading
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = undefined;
    }

    if (this.loader) {
      this.loader.destroy();
      this.loader = null;
    }

    this.setState('unloaded');
  }

  /**
   * Unload texture from memory
   */
  unload(): void {
    this.setState('evicting');

    if (this.loader) {
      this.loader.destroy();
      this.loader = null;
    }

    if (this.texture) {
      this.texture.destroy();
      this.texture = null;
    }

    this._currentLod = Infinity;
    this.memoryUsage = 0;
    this.setState('unloaded');
  }

  // =========================================================================
  // Memory Management
  // =========================================================================

  /**
   * Estimate memory usage in bytes
   */
  private estimateMemoryUsage(): number {
    if (!this.texture) return 0;

    // Estimate based on texture dimensions and format
    const width = this.texture.width || 0;
    const height = this.texture.height || 0;

    // Compressed texture (BC7): 1 byte per pixel
    // Uncompressed (RGBA): 4 bytes per pixel
    const bytesPerPixel = 1; // BC7 compressed

    // Include mipmaps (roughly 1.33x the base level)
    const mipmapMultiplier = 1.33;

    return width * height * bytesPerPixel * mipmapMultiplier;
  }

  getMemoryUsage(): number {
    return this.memoryUsage;
  }

  /**
   * Mark as recently used
   */
  touch(): void {
    this.lastUsed = Date.now();
  }

  getLastUsed(): number {
    return this.lastUsed;
  }

  // =========================================================================
  // Debug
  // =========================================================================

  getMetadata(): TextureMetadata {
    return {
      id: this.id,
      url: this.url,
      category: this.category,
      entity: this.entity,
      state: this._state,
      minLod: this.minLod,
      maxLod: this.maxLod,
      targetLod: this.targetLod,
      currentLod: this._currentLod,
      priority: this._priority,
      userPriority: this.userPriority,
      memoryUsage: this.memoryUsage,
      lastUsed: this.lastUsed,
      loadStartTime: this.loadStartTime,
      loadEndTime: this.loadEndTime,
      error: this.error,
      abortController: this.abortController,
    };
  }

  getLoadTime(): number | undefined {
    if (this.loadStartTime && this.loadEndTime) {
      return this.loadEndTime - this.loadStartTime;
    }
    return undefined;
  }

  // =========================================================================
  // Cleanup
  // =========================================================================

  destroy(): void {
    this.cancel();
    this.unload();
  }
}

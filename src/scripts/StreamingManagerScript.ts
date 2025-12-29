/**
 * PlayCanvas Script for Texture Streaming Manager
 *
 * Manages global texture streaming for the entire scene
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';
import { TextureStreamingManager } from '../systems/streaming/TextureStreamingManager';

// Script class exists at runtime but not exported in types
const Script = (pcRuntime as any).Script;

export class StreamingManagerScript extends Script {
  static scriptName = 'streamingManager';

  declare app: pc.Application;
  declare entity: pc.Entity;

  /**
   * @attribute
   * @description URL to libktx.mjs module (leave empty to use Asset Registry)
   */
  libktxModuleUrl = '';

  /**
   * @attribute
   * @description URL to libktx.wasm binary (leave empty to use Asset Registry)
   */
  libktxWasmUrl = '';

  /**
   * @attribute
   * @range [128, 2048]
   * @description Maximum VRAM budget (MB)
   */
  maxMemoryMB = 512;

  /**
   * @attribute
   * @range [1, 8]
   * @description Maximum concurrent texture loads
   */
  maxConcurrent = 4;

  /**
   * @attribute
   * @range [0.1, 2.0]
   * @description Priority update interval (seconds)
   */
  priorityUpdateInterval = 0.5;

  /**
   * @attribute
   * @description Enable debug logging
   */
  debugLogging = false;

  /**
   * @attribute
   * @description Log priority changes
   */
  logPriorityChanges = false;

  /**
   * @attribute
   * @range [100, 5000]
   * @description Distance weight for priority calculation
   */
  distanceWeight = 1000;

  /**
   * @attribute
   * @description Quality preset (default, mobile, high-quality, high-performance)
   */
  qualityPreset = 'default';

  private streamingManager: TextureStreamingManager | null = null;
  private statsInterval: number = 0;

  async initialize() {
    console.log('[StreamingManager] Initializing...');

    try {
      // Create streaming manager
      this.streamingManager = new TextureStreamingManager(this.app as any, {
        maxMemoryMB: this.maxMemoryMB,
        maxConcurrent: this.maxConcurrent,
        priorityUpdateInterval: this.priorityUpdateInterval,
        distanceWeight: this.distanceWeight,
        debugLogging: this.debugLogging,
        logPriorityChanges: this.logPriorityChanges,
        libktxModuleUrl: this.libktxModuleUrl || undefined,
        libktxWasmUrl: this.libktxWasmUrl || undefined,
      });

      // Apply quality preset
      this.applyQualityPreset(this.qualityPreset);

      // Make globally accessible
      (this.app as any).streamingManager = this.streamingManager;

      console.log('[StreamingManager] Ready!');

      // Print stats every 5 seconds if debug enabled
      if (this.debugLogging) {
        this.statsInterval = window.setInterval(() => {
          this.printStats();
        }, 5000);
      }
    } catch (error) {
      console.error('[StreamingManager] Initialization failed:', error);
    }
  }

  update(dt: number) {
    if (this.streamingManager) {
      this.streamingManager.update(dt);
    }
  }

  /**
   * Apply quality preset
   */
  private applyQualityPreset(preset: string): void {
    if (!this.streamingManager) return;

    const categoryManager = (this.streamingManager as any).categoryManager;

    switch (preset) {
      case 'mobile':
        categoryManager.applyMobilePreset();
        this.streamingManager.setConfig({ maxConcurrent: 2 });
        console.log('[StreamingManager] Applied mobile preset');
        break;

      case 'high-quality':
        categoryManager.applyHighQualityPreset();
        this.streamingManager.setConfig({ maxConcurrent: 6 });
        console.log('[StreamingManager] Applied high-quality preset');
        break;

      case 'high-performance':
        categoryManager.applyHighPerformancePreset();
        this.streamingManager.setConfig({ maxConcurrent: 8 });
        console.log('[StreamingManager] Applied high-performance preset');
        break;

      default:
        categoryManager.applyBalancedPreset();
        console.log('[StreamingManager] Applied default preset');
        break;
    }
  }

  /**
   * Print statistics
   */
  private printStats(): void {
    if (!this.streamingManager) return;

    const stats = this.streamingManager.getStats();
    console.log('[StreamingManager] Stats:', {
      textures: `${stats.loaded}/${stats.totalTextures} loaded`,
      memory: `${stats.memoryUsagePercent.toFixed(1)}% (${(stats.memoryUsed / 1024 / 1024).toFixed(0)}MB / ${(stats.memoryLimit / 1024 / 1024).toFixed(0)}MB)`,
      loading: `${stats.activeLoads}/${stats.maxConcurrent} active, ${stats.queued} queued`,
      categories: {
        persistent: `${stats.categoryStats.persistent.loaded}/${stats.categoryStats.persistent.count}`,
        level: `${stats.categoryStats.level.loaded}/${stats.categoryStats.level.count}`,
        dynamic: `${stats.categoryStats.dynamic.loaded}/${stats.categoryStats.dynamic.count}`,
      },
    });
  }

  /**
   * Get full statistics (for UI)
   */
  getStats() {
    return this.streamingManager?.getStats();
  }

  /**
   * Change quality preset at runtime
   */
  setQualityPreset(preset: string): void {
    this.qualityPreset = preset;
    this.applyQualityPreset(preset);
  }

  /**
   * Update configuration at runtime
   */
  setConfig(config: any): void {
    if (this.streamingManager) {
      this.streamingManager.setConfig(config);
    }
  }

  /**
   * Get streaming manager instance
   */
  getManager(): TextureStreamingManager | null {
    return this.streamingManager;
  }

  onDestroy() {
    // Stop stats logging
    if (this.statsInterval) {
      window.clearInterval(this.statsInterval);
    }

    // Cleanup
    if (this.streamingManager) {
      this.streamingManager.destroy();
      this.streamingManager = null;
    }

    // Remove global reference
    delete (this.app as any).streamingManager;
  }
}

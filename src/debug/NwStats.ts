/**
 * NwStats - Runtime statistics for North Wind asset pipeline
 *
 * Writes counters into app.stats.nw so MiniStats can display them natively.
 * Also activates pc.Tracing channels when running under PlayCanvas debug build.
 *
 * Usage:
 *   // In ProcessedAssetManager.initialize():
 *   NwStats.init(app);
 *
 *   // Optionally mount MiniStats with NW graphs:
 *   NwStats.createMiniStats(app);
 *
 *   // From console at any time:
 *   app.stats.nw
 */

import type * as pc from 'playcanvas';

// ============================================================================
// Types
// ============================================================================

export interface NwMaterialStats {
  /** Number of registered master materials */
  masters: number;
  /** Total created instances (cumulative) */
  instances: number;
  /** Currently loading instance JSON requests in-flight */
  loading: number;
  /** Instance count per master name */
  byMaster: Record<string, number>;
}

export interface NwTextureStats {
  /** Fully loaded unique textures */
  loaded: number;
  /** Currently loading */
  loading: number;
}

export interface NwLodStats {
  /** Number of entities tracked by LodManager */
  tracked: number;
}

export interface NwStatsData {
  materials: NwMaterialStats;
  textures: NwTextureStats;
  lod: NwLodStats;
}

// ============================================================================
// NwStats
// ============================================================================

export class NwStats {
  private static app: pc.Application | null = null;
  private static data: NwStatsData = NwStats.createEmpty();

  private static createEmpty(): NwStatsData {
    return {
      materials: { masters: 0, instances: 0, loading: 0, byMaster: {} },
      textures:  { loaded: 0, loading: 0 },
      lod:       { tracked: 0 },
    };
  }

  // ============================================================================
  // Init
  // ============================================================================

  /**
   * Call once after app is created, before loading begins.
   * Mounts data onto app.stats.nw and optionally activates pc.Tracing.
   */
  static init(app: pc.Application): void {
    NwStats.app = app;
    NwStats.data = NwStats.createEmpty();

    // Mount into app.stats so MiniStats can read it by path 'nw.*'
    (app.stats as any).nw = NwStats.data;

    // Expose globally for console access:
    //   __NW__.stats       → live counters
    //   __NW__.app         → pc.Application instance
    //   __NW__.miniStats() → mount MiniStats overlay
    (globalThis as any).__NW__ = {
      stats:     NwStats.data,
      app,
      miniStats: (sizeIndex = 1) => NwStats.createMiniStats(app, sizeIndex),
      tracing:   (channel: string, enabled = true) => {
        const pc = (globalThis as any).pc;
        if (pc?.Tracing?.set) {
          pc.Tracing.set(channel, enabled);
          console.log(`[NwStats] Tracing ${channel} = ${enabled}`);
        } else {
          console.warn('[NwStats] pc.Tracing not available (production build)');
        }
      },
    };

    console.log('[NwStats] Ready. Use __NW__ in console: __NW__.stats, __NW__.miniStats(), __NW__.app');

    // Activate PC native tracing if running in a debug build
    NwStats.tryEnablePcTracing();
  }

  /**
   * Enable pc.Tracing channels if the debug build is available.
   * In production build these are no-ops so calling them is safe.
   */
  private static tryEnablePcTracing(): void {
    const pc = (globalThis as any).pc;
    if (!pc?.Tracing) return;

    // pc.Debug only exists in debug builds
    const isDebugBuild = typeof pc.Debug?.error === 'function';
    if (!isDebugBuild) return;

    try {
      pc.Tracing.set(pc.TRACEID_SHADER_ALLOC,    true);
      pc.Tracing.set(pc.TRACEID_SHADER_COMPILE,  true);
      pc.Tracing.set(pc.TRACEID_TEXTURE_ALLOC,   true);
      pc.Tracing.set(pc.TRACEID_VRAM_TEXTURE,    true);
      pc.Tracing.set(pc.TRACEID_ASSETS,          true);
      console.log('[NwStats] pc.Tracing activated (debug build detected)');
    } catch (e) {
      // Older engine build — some IDs may not exist
      console.warn('[NwStats] pc.Tracing partial activation:', e);
    }
  }

  // ============================================================================
  // Material hooks — called from MaterialInstanceLoader
  // ============================================================================

  static onMasterRegistered(_name: string): void {
    NwStats.data.materials.masters++;
  }

  static onInstanceLoadStart(): void {
    NwStats.data.materials.loading++;
  }

  static onInstanceLoadEnd(): void {
    NwStats.data.materials.loading = Math.max(0, NwStats.data.materials.loading - 1);
  }

  static onInstanceCreated(masterName: string): void {
    NwStats.data.materials.instances++;
    const prev = NwStats.data.materials.byMaster[masterName] ?? 0;
    NwStats.data.materials.byMaster[masterName] = prev + 1;
  }

  static onInstanceUnloaded(masterName: string): void {
    NwStats.data.materials.instances = Math.max(0, NwStats.data.materials.instances - 1);
    const prev = NwStats.data.materials.byMaster[masterName] ?? 0;
    NwStats.data.materials.byMaster[masterName] = Math.max(0, prev - 1);
  }

  // ============================================================================
  // Texture hooks — called from ProcessedAssetManager
  // ============================================================================

  static onTextureLoadStart(): void {
    NwStats.data.textures.loading++;
  }

  static onTextureLoadEnd(failed = false): void {
    NwStats.data.textures.loading = Math.max(0, NwStats.data.textures.loading - 1);
    if (!failed) {
      NwStats.data.textures.loaded++;
    }
  }

  // ============================================================================
  // LOD hooks — called from LodManager / ProcessedAssetManager
  // ============================================================================

  static setLodTracked(count: number): void {
    NwStats.data.lod.tracked = count;
  }

  // ============================================================================
  // MiniStats
  // ============================================================================

  /**
   * Create a MiniStats instance pre-configured with NW graphs.
   * Requires pc.MiniStats to be available (extras bundle or debug launch).
   *
   * @param startSizeIndex 0=small, 1=medium, 2=large
   */
  static createMiniStats(app: pc.Application, startSizeIndex = 1): any {
    const MiniStats = (globalThis as any).pc?.MiniStats;
    if (!MiniStats) {
      console.warn('[NwStats] pc.MiniStats not available — skipped');
      return null;
    }

    return new MiniStats(app, {
      startSizeIndex,
      stats: [
        {
          name: 'MatInst',
          stats: ['nw.materials.instances'],
          watermark: 200,
        },
        {
          name: 'MatLoad',
          stats: ['nw.materials.loading'],
          watermark: 8,
        },
        {
          name: 'TexLoad',
          stats: ['nw.textures.loading'],
          watermark: 8,
        },
        {
          name: 'TexDone',
          stats: ['nw.textures.loaded'],
          watermark: 500,
        },
        {
          name: 'LOD',
          stats: ['nw.lod.tracked'],
          watermark: 100,
        },
      ],
    });
  }

  // ============================================================================
  // Read
  // ============================================================================

  /** Direct access to stats data (read-only snapshot) */
  static getSnapshot(): NwStatsData {
    return JSON.parse(JSON.stringify(NwStats.data));
  }
}

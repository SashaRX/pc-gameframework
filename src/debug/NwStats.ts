/**
 * NwStats - Runtime statistics for North Wind asset pipeline
 *
 * Writes counters into app.stats so MiniStats can display them natively.
 * MiniStats reads stats via flat string keys (e.g. "nwMatInst"),
 * so we mount flat counters directly on app.stats alongside
 * a nested app.stats.nw object for console convenience.
 *
 * Usage:
 *   NwStats.init(app);              // in NwDebugScript or ProcessedAssetManager
 *   __NW__.stats                    // console: nested view
 *   __NW__.miniStats()              // mount MiniStats overlay
 *   app.stats.nwMatInst             // flat counter readable by MiniStats
 */

import type * as pc from 'playcanvas';

// ============================================================================
// Types
// ============================================================================

export interface NwMaterialStats {
  masters: number;
  instances: number;
  loading: number;
  byMaster: Record<string, number>;
}

export interface NwTextureStats {
  loaded: number;
  loading: number;
}

export interface NwLodStats {
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
   * Mounts flat counters on app.stats (for MiniStats) and
   * a nested app.stats.nw object (for console convenience).
   */
  static init(app: pc.Application): void {
    NwStats.app = app;
    NwStats.data = NwStats.createEmpty();

    // Nested object for console: app.stats.nw / __NW__.stats
    (app.stats as any).nw = NwStats.data;

    // Flat counters for MiniStats (reads single-level keys from app.stats)
    // Updated via syncFlat() on every counter change
    NwStats.syncFlat(app);

    // Expose globally for console access
    (globalThis as any).__NW__ = {
      stats:     NwStats.data,
      app,
      miniStats: (sizeIndex = 1) => NwStats.createMiniStats(app, sizeIndex),
      overlay:   (rateMs = 1000) => NwStats.createOverlay(rateMs),
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
   * Sync nested data → flat keys on app.stats.
   * MiniStats reads these as app.stats[key].
   */
  private static syncFlat(app: pc.Application): void {
    const s = app.stats as any;
    s.nwMatMasters   = NwStats.data.materials.masters;
    s.nwMatInst      = NwStats.data.materials.instances;
    s.nwMatLoading   = NwStats.data.materials.loading;
    s.nwTexLoaded    = NwStats.data.textures.loaded;
    s.nwTexLoading   = NwStats.data.textures.loading;
    s.nwLodTracked   = NwStats.data.lod.tracked;
  }

  private static sync(): void {
    if (NwStats.app) NwStats.syncFlat(NwStats.app);
  }

  // ============================================================================
  // Private — pc.Tracing
  // ============================================================================

  private static tryEnablePcTracing(): void {
    const pc = (globalThis as any).pc;
    if (!pc?.Tracing) return;

    const isDebugBuild = typeof pc.Debug?.error === 'function';
    if (!isDebugBuild) return;

    try {
      pc.Tracing.set(pc.TRACEID_SHADER_ALLOC,   true);
      pc.Tracing.set(pc.TRACEID_SHADER_COMPILE,  true);
      pc.Tracing.set(pc.TRACEID_TEXTURE_ALLOC,   true);
      pc.Tracing.set(pc.TRACEID_VRAM_TEXTURE,    true);
      pc.Tracing.set(pc.TRACEID_ASSETS,          true);
      console.log('[NwStats] pc.Tracing activated (debug build detected)');
    } catch (e) {
      console.warn('[NwStats] pc.Tracing partial activation:', e);
    }
  }

  // ============================================================================
  // Material hooks
  // ============================================================================

  static onMasterRegistered(_name: string): void {
    NwStats.data.materials.masters++;
    NwStats.sync();
  }

  static onInstanceLoadStart(): void {
    NwStats.data.materials.loading++;
    NwStats.sync();
  }

  static onInstanceLoadEnd(): void {
    NwStats.data.materials.loading = Math.max(0, NwStats.data.materials.loading - 1);
    NwStats.sync();
  }

  static onInstanceCreated(masterName: string): void {
    NwStats.data.materials.instances++;
    const prev = NwStats.data.materials.byMaster[masterName] ?? 0;
    NwStats.data.materials.byMaster[masterName] = prev + 1;
    NwStats.sync();
  }

  static onInstanceUnloaded(masterName: string): void {
    NwStats.data.materials.instances = Math.max(0, NwStats.data.materials.instances - 1);
    const prev = NwStats.data.materials.byMaster[masterName] ?? 0;
    NwStats.data.materials.byMaster[masterName] = Math.max(0, prev - 1);
    NwStats.sync();
  }

  // ============================================================================
  // Texture hooks
  // ============================================================================

  static onTextureLoadStart(): void {
    NwStats.data.textures.loading++;
    NwStats.sync();
  }

  static onTextureLoadEnd(failed = false): void {
    NwStats.data.textures.loading = Math.max(0, NwStats.data.textures.loading - 1);
    if (!failed) NwStats.data.textures.loaded++;
    NwStats.sync();
  }

  // ============================================================================
  // LOD hooks
  // ============================================================================

  static setLodTracked(count: number): void {
    NwStats.data.lod.tracked = count;
    NwStats.sync();
  }

  // ============================================================================
  // MiniStats
  // ============================================================================

  /**
   * Create MiniStats pre-configured with NW pipeline graphs.
   * Uses flat key paths (e.g. "nwMatInst") that MiniStats can read directly.
   */
  static createMiniStats(app: pc.Application, startSizeIndex = 1): any {
    const pc = (globalThis as any).pc;
    const MiniStats = pc?.MiniStats;
    if (!MiniStats) {
      console.warn('[NwStats] pc.MiniStats not available — skipped');
      return null;
    }

    // Start from default options (cpu, gpu, sizes etc.) to avoid initGraphs crash,
    // then append our custom NW graphs on top
    const defaults = MiniStats.getDefaultOptions?.() ?? {};
    const nwGraphs = [
      { name: 'MatInst',  stats: ['nwMatInst'],    watermark: 200 },
      { name: 'MatLoad',  stats: ['nwMatLoading'],  watermark: 8   },
      { name: 'TexLoad',  stats: ['nwTexLoading'],  watermark: 8   },
      { name: 'TexDone',  stats: ['nwTexLoaded'],   watermark: 500 },
      { name: 'LOD',      stats: ['nwLodTracked'],  watermark: 100 },
    ];

    const options = {
      ...defaults,
      startSizeIndex,
      stats: [...(defaults.stats ?? []), ...nwGraphs],
    };

    return new MiniStats(app, options);
  }

  // ============================================================================
  // Overlay — отдельное окно в правом верхнем углу
  // ============================================================================

  /**
   * Создаёт HTML-оверлей в правом верхнем углу с NW-счётчиками.
   * Обновляется каждые updateRateMs миллисекунд.
   * Возвращает функцию destroy() для удаления.
   *
   * __NW__.overlay()        // создать
   * __NW__.overlay(500)     // обновление каждые 500мс
   */
  static createOverlay(updateRateMs = 1000): () => void {
    document.getElementById('nw-overlay')?.remove();

    const root = document.createElement('div');
    root.id = 'nw-overlay';
    Object.assign(root.style, {
      position:      'fixed',
      top:           '8px',
      right:         '8px',
      zIndex:        '99999',
      background:    'rgba(10, 10, 14, 0.88)',
      color:         '#c8c8d0',
      font:          '11px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      padding:       '7px 10px 8px',
      borderRadius:  '5px',
      minWidth:      '170px',
      pointerEvents: 'none',
      whiteSpace:    'pre',
      letterSpacing: '0.01em',
      borderLeft:    '2px solid #38a',
      boxShadow:     '0 2px 8px rgba(0,0,0,0.5)',
    });
    document.body.appendChild(root);

    // Создаём строки: label-span + value-span для независимой раскраски
    const rows: Array<{ label: string; key: string; color: string }> = [
      { label: 'Masters  ', key: 'masters',   color: '#7af' },
      { label: 'Instances', key: 'instances', color: '#af7' },
      { label: 'Mat Load ', key: 'matLoad',   color: '#fa7' },
      { label: 'Tex Done ', key: 'texDone',   color: '#af7' },
      { label: 'Tex Load ', key: 'texLoad',   color: '#fa7' },
      { label: 'LOD      ', key: 'lod',       color: '#7af' },
    ];

    // Header
    const header = document.createElement('div');
    header.textContent = 'NW Stats';
    Object.assign(header.style, { color: '#88aacc', marginBottom: '4px', fontSize: '10px', letterSpacing: '0.05em' });
    root.appendChild(header);

    // Divider
    const div0 = document.createElement('div');
    div0.textContent = ''.padEnd(20, '-');
    Object.assign(div0.style, { color: '#333', marginBottom: '2px' });
    root.appendChild(div0);

    // Rows
    const valueEls: Record<string, HTMLElement> = {};
    for (const row of rows) {
      const line = document.createElement('div');
      const labelEl = document.createElement('span');
      labelEl.textContent = row.label + ' ';
      labelEl.style.color = '#888';
      const valEl = document.createElement('span');
      valEl.style.color = row.color;
      valEl.textContent = '0';
      valueEls[row.key] = valEl;
      line.appendChild(labelEl);
      line.appendChild(valEl);
      root.appendChild(line);
    }

    // byMaster section
    const byMasterEl = document.createElement('div');
    byMasterEl.style.marginTop = '3px';
    root.appendChild(byMasterEl);

    const update = () => {
      const m = NwStats.data.materials;
      const t = NwStats.data.textures;
      const l = NwStats.data.lod;

      valueEls['masters'].textContent   = String(m.masters);
      valueEls['instances'].textContent = String(m.instances);
      valueEls['matLoad'].textContent   = String(m.loading);
      valueEls['texDone'].textContent   = String(t.loaded);
      valueEls['texLoad'].textContent   = String(t.loading);
      valueEls['lod'].textContent       = String(l.tracked);

      // Highlight non-zero loading
      valueEls['matLoad'].style.color = m.loading > 0 ? '#ffa' : '#fa7';
      valueEls['texLoad'].style.color = t.loading > 0 ? '#ffa' : '#fa7';

      // byMaster breakdown
      const entries = Object.entries(m.byMaster).filter(([, v]) => v > 0);
      byMasterEl.innerHTML = '';
      if (entries.length > 0) {
        const sep = document.createElement('div');
        sep.textContent = ''.padEnd(20, '-');
        sep.style.color = '#333';
        byMasterEl.appendChild(sep);
        for (const [k, v] of entries) {
          const row = document.createElement('div');
          const lbl = document.createElement('span');
          lbl.style.color = '#666';
          lbl.textContent = '  ' + k.slice(0, 12).padEnd(12) + ' ';
          const val = document.createElement('span');
          val.style.color = '#af7';
          val.textContent = String(v);
          row.appendChild(lbl);
          row.appendChild(val);
          byMasterEl.appendChild(row);
        }
      }
    };

    update();
    const intervalId = window.setInterval(update, updateRateMs);
    return () => { clearInterval(intervalId); root.remove(); };
  }

  // ============================================================================
  // Read
  // ============================================================================

  static getSnapshot(): NwStatsData {
    return JSON.parse(JSON.stringify(NwStats.data));
  }
}

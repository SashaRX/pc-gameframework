/**
 * NwDebugScript - Standalone debug initializer
 *
 * Attach to ANY entity in the scene to activate NwStats and __NW__ global.
 * Does NOT require mappingUrl or any other config.
 *
 * After init, use in browser console:
 *   __NW__.stats         // live counters
 *   __NW__.app           // pc.Application
 *   __NW__.miniStats()   // mount MiniStats overlay with NW graphs
 *   __NW__.tracing(pc.TRACEID_SHADER_ALLOC)  // enable pc.Tracing (debug build only)
 */

import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';
import { NwStats } from '../debug/NwStats';

const Script = (pcRuntime as any).Script;

export class NwDebugScript extends Script {
  static readonly scriptName = 'nwDebug';

  declare app: pc.Application;

  initialize(): void {
    NwStats.init(this.app);
    console.log('[NwDebugScript] Ready. Use __NW__ in console: __NW__.stats, __NW__.miniStats(), __NW__.app');
  }
}

(pcRuntime as any).registerScript(NwDebugScript, 'nwDebug');

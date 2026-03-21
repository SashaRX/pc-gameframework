/**
 * NwDebugScript - Standalone debug initializer
 *
 * Attach to ANY entity in the scene to activate NwStats and __NW__ global.
 * Does NOT require mappingUrl or any other config.
 * Safe to keep in scene permanently — no runtime cost.
 *
 * After init, use in browser console:
 *   __NW__.stats         // live counters
 *   __NW__.app           // pc.Application
 *   __NW__.miniStats()   // mount MiniStats overlay with NW graphs
 *   __NW__.tracing(pc.TRACEID_SHADER_ALLOC)  // enable pc.Tracing (debug build only)
 */

import * as pc from 'playcanvas';
import { NwStats } from '../debug/NwStats';

export class NwDebugScript extends pc.ScriptType {
  initialize(): void {
    NwStats.init(this.app);
    console.log('[NwDebugScript] Ready. __NW__ is available in console.');
  }
}

NwDebugScript.scriptName = 'nwDebug';
pc.registerScript(NwDebugScript, 'nwDebug');

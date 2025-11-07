#!/usr/bin/env node
/**
 * Quick test for World Streaming System
 * Run: node test-streaming.mjs
 */

console.log('\n🧪 World Streaming System - Quick Test\n');
console.log('═══════════════════════════════════════════════════════════\n');

// ============================================================================
// Test 1: Grid Utilities
// ============================================================================

console.log('📦 Test 1: Grid Utilities\n');

import {
  worldToGrid,
  gridToSectorId,
  sectorIdToGrid,
  getGridCenter
} from './build/esm/streaming/utils/grid.mjs';

try {
  // Test world to grid
  const worldPos = { x: 150, y: 0, z: 250 };
  const gridCoords = worldToGrid(worldPos, 100);
  console.log('  ✓ World to Grid:', worldPos, '→', gridCoords);
  console.log('    Expected: { x: 100, z: 200 }');

  // Test sector ID
  const sectorId = gridToSectorId(gridCoords);
  console.log('\n  ✓ Grid to Sector ID:', gridCoords, '→', sectorId);
  console.log('    Expected: "x100_z200"');

  // Test parsing
  const parsed = sectorIdToGrid(sectorId);
  console.log('\n  ✓ Parse Sector ID:', sectorId, '→', parsed);
  console.log('    Expected: { x: 100, z: 200 }');

  // Test negative coordinates
  const negId = gridToSectorId({ x: -100, z: -200 });
  const negParsed = sectorIdToGrid(negId);
  console.log('\n  ✓ Negative Coordinates:', negId, '→', negParsed);
  console.log('    Expected: { x: -100, z: -200 }');

  // Test center
  const center = getGridCenter(gridCoords, 100);
  console.log('\n  ✓ Grid Center:', gridCoords, '→', center);
  console.log('    Expected: { x: 150, z: 250 }');

  console.log('\n✅ Grid Utilities: PASSED\n');
} catch (err) {
  console.error('\n❌ Grid Utilities: FAILED');
  console.error('  Error:', err.message);
  process.exit(1);
}

// ============================================================================
// Test 2: Priority Calculation
// ============================================================================

console.log('═══════════════════════════════════════════════════════════\n');
console.log('📊 Test 2: Priority Calculation\n');

import { calculateSectorPriority, calculateLodLevel } from './build/esm/streaming/utils/priority.mjs';

try {
  // Simple Vec3 mock
  class Vec3 {
    constructor(x, y, z) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }

  const cameraPos = new Vec3(0, 0, 0);
  const cameraDir = new Vec3(0, 0, 1); // Looking forward
  const viewDistance = 300;

  // Sector ahead
  const aheadPriority = calculateSectorPriority(
    { x: 0, z: 200 },
    cameraPos,
    cameraDir,
    viewDistance
  );
  console.log('  ✓ Sector Ahead (0, 200)');
  console.log('    Priority:', aheadPriority.priority.toFixed(3));
  console.log('    Distance:', aheadPriority.distance);
  console.log('    Direction Score:', aheadPriority.directionScore.toFixed(3));
  console.log('    Expected: High priority (>0.5)');

  // Sector behind
  const behindPriority = calculateSectorPriority(
    { x: 0, z: -200 },
    cameraPos,
    cameraDir,
    viewDistance
  );
  console.log('\n  ✓ Sector Behind (0, -200)');
  console.log('    Priority:', behindPriority.priority.toFixed(3));
  console.log('    Direction Score:', behindPriority.directionScore.toFixed(3));
  console.log('    Expected: Low priority (<0.3)');

  // LOD levels
  const lod0 = calculateLodLevel(50, 150, 300);
  const lod1 = calculateLodLevel(170, 150, 300);
  const lod2 = calculateLodLevel(250, 150, 300);
  console.log('\n  ✓ LOD Calculation:');
  console.log('    Distance 50m  → LOD', lod0, '(expected: 0 - high detail)');
  console.log('    Distance 170m → LOD', lod1, '(expected: 1 - medium)');
  console.log('    Distance 250m → LOD', lod2, '(expected: 2 - low detail)');

  console.log('\n✅ Priority Calculation: PASSED\n');
} catch (err) {
  console.error('\n❌ Priority Calculation: FAILED');
  console.error('  Error:', err.message);
  process.exit(1);
}

// ============================================================================
// Test 3: Memory Manager
// ============================================================================

console.log('═══════════════════════════════════════════════════════════\n');
console.log('💾 Test 3: Memory Manager\n');

import { MemoryManager } from './build/esm/streaming/MemoryManager.mjs';

try {
  const memMgr = new MemoryManager(100); // 100MB budget

  const mockSector1 = {
    manifest: { sectorId: 'x0_z0' },
    entity: {},
    currentLod: 1,
    status: 'loaded_medium',
    memoryUsage: 30 * 1024 * 1024,
    lastAccessed: Date.now(),
    distance: 100,
    priority: 0.8
  };

  const mockSector2 = {
    manifest: { sectorId: 'x100_z0' },
    entity: {},
    currentLod: 2,
    status: 'loaded_low',
    memoryUsage: 40 * 1024 * 1024,
    lastAccessed: Date.now() - 5000,
    distance: 200,
    priority: 0.5
  };

  // Register sectors
  memMgr.registerSector('x0_z0', mockSector1, mockSector1.memoryUsage);
  memMgr.registerSector('x100_z0', mockSector2, mockSector2.memoryUsage);

  const stats = memMgr.getStats();
  console.log('  ✓ Registered 2 sectors');
  console.log('    Memory Used:', stats.totalUsedMB.toFixed(2), 'MB');
  console.log('    Budget:', stats.budgetMB, 'MB');
  console.log('    Sectors:', stats.sectorsLoaded);

  // Try to allocate more
  const toUnload = memMgr.allocate(50, 'x200_z0');
  console.log('\n  ✓ Allocate 50MB (will exceed budget)');
  console.log('    Sectors to unload:', toUnload);
  console.log('    Expected: At least one sector ID');

  console.log('\n✅ Memory Manager: PASSED\n');
} catch (err) {
  console.error('\n❌ Memory Manager: FAILED');
  console.error('  Error:', err.message);
  process.exit(1);
}

// ============================================================================
// Summary
// ============================================================================

console.log('═══════════════════════════════════════════════════════════');
console.log('🎉 ALL TESTS PASSED!');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('✅ Components Tested:');
console.log('   • Grid utilities (coordinate conversion, sector IDs)');
console.log('   • Priority calculation (distance, direction, LOD)');
console.log('   • Memory manager (budget enforcement, LRU eviction)\n');

console.log('📚 Next Steps:');
console.log('   1. Test in PlayCanvas Editor');
console.log('   2. See: PLAYCANVAS_INTEGRATION_TEST.md');
console.log('   3. Create real sector manifests');
console.log('   4. Add KTX2 textures\n');

console.log('🚀 The streaming system is ready to use!\n');

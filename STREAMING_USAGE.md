# Texture Streaming Manager - Usage Guide

## Overview

The **Texture Streaming Manager** is a priority-based texture loading system for PlayCanvas that manages multiple KTX2 textures with intelligent memory management and distance-based prioritization.

## Quick Start

### 1. Add StreamingManager Script

In PlayCanvas Editor:
1. Create empty entity (e.g., "StreamingManager")
2. Add `StreamingManagerScript` component
3. Configure settings:
   - **Max Memory MB**: 512 (adjust based on target platform)
   - **Max Concurrent**: 4 (parallel loads)
   - **Debug Logging**: true (for development)

### 2. Register Textures

#### Method A: Via Script (Recommended)

```javascript
// Get streaming manager from global
const streaming = this.app.streamingManager;

// Register a texture
streaming.register({
  id: 'ground-albedo',
  url: 'https://your-cdn.com/ground-albedo.ktx2',
  category: 'level',        // 'persistent' | 'level' | 'dynamic'
  entity: this.entity,
  targetLod: 3,             // 0=full quality, higher=lower
  userPriority: 1.0,        // 0-2, higher=more important
});
```

#### Method B: Create Helper Script

```typescript
import type * as pc from 'playcanvas';
import * as pcRuntime from 'playcanvas';

const Script = (pcRuntime as any).Script;

export class StreamedTextureScript extends Script {
  static scriptName = 'streamedTexture';

  declare app: pc.Application;
  declare entity: pc.Entity;

  /**
   * @attribute
   */
  ktxUrl = '';

  /**
   * @attribute
   */
  textureId = '';

  /**
   * @attribute
   */
  category = 'dynamic';

  /**
   * @attribute
   * @range [0, 10]
   */
  targetLod = 5;

  /**
   * @attribute
   * @range [0, 2]
   */
  userPriority = 1.0;

  initialize() {
    const streaming = (this.app as any).streamingManager;
    if (!streaming) {
      console.error('[StreamedTexture] StreamingManager not found');
      return;
    }

    streaming.register({
      id: this.textureId || this.entity.name,
      url: this.ktxUrl,
      category: this.category as any,
      entity: this.entity,
      targetLod: this.targetLod,
      userPriority: this.userPriority,
    });
  }

  onDestroy() {
    const streaming = (this.app as any).streamingManager;
    if (streaming) {
      streaming.unregister(this.textureId || this.entity.name);
    }
  }
}
```

## Categories

### Persistent
**Always loaded, highest priority**

Use for:
- UI elements
- Player character
- Weapons
- HUD textures

```javascript
streaming.register({
  id: 'player-skin',
  url: 'player-skin.ktx2',
  category: 'persistent',
  entity: playerEntity,
  targetLod: 0, // Full quality
});
```

### Level
**Loaded with level, medium priority**

Use for:
- Level geometry
- Buildings
- Terrain
- Static props

```javascript
streaming.register({
  id: 'level1-ground',
  url: 'level1-ground.ktx2',
  category: 'level',
  entity: groundEntity,
  targetLod: 3, // Medium quality
});
```

### Dynamic
**Streamed by distance, variable priority**

Use for:
- Far objects
- LOD objects
- Optional details
- Background elements

```javascript
streaming.register({
  id: 'building-42',
  url: 'building-42.ktx2',
  category: 'dynamic',
  entity: buildingEntity,
  minLod: 7,  // Low quality base
  maxLod: 0,  // Full quality when close
  targetLod: 5, // Start here
});
```

## Configuration

### Global Settings

```javascript
const streaming = this.app.streamingManager;

streaming.setConfig({
  maxMemoryMB: 512,              // VRAM budget
  maxConcurrent: 4,               // Parallel loads
  priorityUpdateInterval: 0.5,    // Priority recalc (seconds)
  distanceWeight: 1000,           // Priority scale
  debugLogging: true,
  logPriorityChanges: false,
});
```

### Category Settings

```javascript
streaming.setCategoryConfig('dynamic', {
  loadImmediately: false,
  keepInMemory: false,
  targetLod: 5,
  priorityWeight: 100,
  maxMemoryMB: 200,
});
```

### Quality Presets

```javascript
// Mobile - low quality, aggressive memory
streaming.getManager().categoryManager.applyMobilePreset();

// High Quality - maximum detail
streaming.getManager().categoryManager.applyHighQualityPreset();

// High Performance - low quality, fast loading
streaming.getManager().categoryManager.applyHighPerformancePreset();

// Balanced (default)
streaming.getManager().categoryManager.applyBalancedPreset();
```

Or via script attribute:
- Set `qualityPreset` to "mobile", "high-quality", "high-performance", or "default"

## Manual Control

### Load/Unload

```javascript
// Force load
streaming.requestLoad('texture-id', priority);

// Force unload
streaming.requestUnload('texture-id');
```

### Priority Override

```javascript
// Boost priority (e.g., player looking at object)
streaming.setUserPriority('important-texture', 2.0);

// Lower priority
streaming.setUserPriority('background-texture', 0.5);
```

### Bulk Operations

```javascript
// Unload entire category
streaming.unregisterCategory('level');

// Unload all textures on entity
streaming.unregisterEntity(entity);
```

## Monitoring

### Get Statistics

```javascript
const stats = streaming.getStats();

console.log('Textures:', `${stats.loaded}/${stats.totalTextures}`);
console.log('Memory:', `${stats.memoryUsagePercent.toFixed(1)}%`);
console.log('Loading:', `${stats.activeLoads} active, ${stats.queued} queued`);
console.log('Categories:', stats.categoryStats);
```

### Debug Info

```javascript
// Print detailed stats
streaming.debug();

// Get per-texture debug info
const debugInfo = streaming.getDebugInfo();
```

## Priority Calculation

```
priority = (1 / (1 + distance * 0.1)) * categoryWeight * userPriority * distanceWeight
```

**Factors:**
- **Distance**: Closer objects = higher priority
- **Category Weight**:
  - Persistent: 1000
  - Level: 500
  - Dynamic: 100
- **User Priority**: 0-2 (manual override)
- **Distance Weight**: Global multiplier (default 1000)

**Examples:**

```
Object 10 units away (dynamic):
  distanceFactor = 1 / (1 + 10 * 0.1) = 0.5
  priority = 0.5 * 100 * 1.0 * 1000 = 50000

Same object (persistent):
  priority = 0.5 * 1000 * 1.0 * 1000 = 500000
```

## Memory Management

### Automatic Eviction

When memory pressure is **high** (>85%):
- System automatically evicts low-priority textures
- Uses hybrid LRU + Priority strategy
- Persistent textures never evicted

### Memory Pressure Levels

- **None** (<60%): All good
- **Low** (60-75%): Monitoring
- **Medium** (75-85%): May evict soon
- **High** (85-95%): Active eviction
- **Critical** (>95%): Aggressive eviction

### Check Memory

```javascript
const memoryTracker = streaming.getManager().memoryTracker;
const stats = memoryTracker.getStats();

console.log('Pressure:', stats.pressure); // 'none' | 'low' | 'medium' | 'high' | 'critical'
console.log('Used:', `${(stats.used / 1024 / 1024).toFixed(0)} MB`);
console.log('Available:', `${(stats.availabe / 1024 / 1024).toFixed(0)} MB`);
```

## Best Practices

### 1. Category Assignment

- **Persistent**: < 10 textures, < 200MB total
- **Level**: 20-50 textures, < 300MB total
- **Dynamic**: Rest, managed automatically

### 2. Target LOD Selection

- Persistent: 0-1 (full quality)
- Level: 2-4 (medium quality)
- Dynamic: 5-7 (base quality, upgrades by distance)

### 3. Memory Budget

- **Desktop**: 512-1024MB
- **Mobile High**: 256-512MB
- **Mobile Low**: 128-256MB

### 4. Concurrent Loads

- **Desktop**: 4-6
- **Mobile**: 2-4
- **Bandwidth Limited**: 2-3

### 5. Update Interval

- **Top-down view**: 1.0s (camera moves slowly)
- **First-person**: 0.3-0.5s (camera moves fast)
- **Static camera**: 2.0s (rarely updates)

## Example: Level Loading

```javascript
class LevelManager extends Script {
  async loadLevel(levelId) {
    const streaming = this.app.streamingManager;

    // Clear previous level
    streaming.unregisterCategory('level');

    // Load new level textures
    const levelTextures = this.getLevelTextures(levelId);

    for (const tex of levelTextures) {
      streaming.register({
        id: `level-${levelId}-${tex.name}`,
        url: tex.url,
        category: 'level',
        entity: tex.entity,
        targetLod: 3,
      });
    }

    // Wait for critical textures to load
    await this.waitForTextures([...criticalIds]);
  }

  async waitForTextures(ids) {
    const streaming = this.app.streamingManager;
    const checkInterval = 100; // ms

    while (true) {
      const stats = streaming.getStats();
      const allLoaded = ids.every(id =>
        streaming.getManager().registry.get(id)?.isLoaded
      );

      if (allLoaded) break;
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
  }
}
```

## Troubleshooting

### Textures Not Loading

1. Check registration: `streaming.debug()`
2. Check memory: Is budget exceeded?
3. Check priority: Is priority too low?
4. Check queue: `streaming.getStats().queued`

### Memory Leaks

1. Always unregister textures when entity destroyed
2. Clear level textures when switching levels
3. Check `streaming.getStats().categoryStats`

### Low Performance

1. Reduce `maxConcurrent` (lower bandwidth usage)
2. Increase `priorityUpdateInterval` (less CPU)
3. Apply "high-performance" preset
4. Reduce `targetLod` for categories

### Frequent Evictions

1. Increase `maxMemoryMB`
2. Reduce `targetLod` (load lower quality)
3. Unregister unused textures
4. Review category assignments

## Advanced: View Mode Switching

```javascript
class CameraController extends Script {
  switchToFirstPerson() {
    const streaming = this.app.streamingManager;

    // Boost nearby textures
    const nearbyEntities = this.getNearbyEntities(10);
    for (const entity of nearbyEntities) {
      const handles = streaming.getManager().registry.getByEntity(entity.getGuid());
      for (const handle of handles) {
        handle.setUserPriority(2.0); // Max priority
      }
    }

    // Adjust update interval for faster camera
    streaming.setConfig({ priorityUpdateInterval: 0.3 });
  }

  switchToTopDown() {
    // Relax priorities
    const streaming = this.app.streamingManager;
    streaming.getManager().registry.getAll().forEach(h => h.setUserPriority(1.0));

    // Slower updates
    streaming.setConfig({ priorityUpdateInterval: 1.0 });
  }
}
```

## API Reference

See `src/streaming/types.ts` for complete type definitions.

### TextureStreamingManager

- `register(options)` - Register texture
- `unregister(id)` - Unregister texture
- `update(dt)` - Call every frame
- `getStats()` - Get statistics
- `setConfig(config)` - Update configuration
- `setCategoryConfig(category, config)` - Update category
- `requestLoad(id, priority?)` - Force load
- `requestUnload(id)` - Force unload
- `setUserPriority(id, priority)` - Override priority
- `debug()` - Print debug info
- `destroy()` - Cleanup

---

**Ready to use! Add `StreamingManagerScript` to your scene and start registering textures.** 🚀

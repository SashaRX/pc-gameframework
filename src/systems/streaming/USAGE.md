# TextureStreamingManager Usage Guide

Complete texture streaming system for PlayCanvas with automatic memory management and distance-based priority loading.

## Quick Start

```typescript
import { TextureStreamingManager } from './streaming';
import type * as pc from 'playcanvas';

// 1. Initialize manager
const streamingManager = new TextureStreamingManager(app, {
  maxMemoryMB: 512,              // 512MB VRAM budget
  maxConcurrent: 4,               // 4 parallel texture loads
  priorityUpdateInterval: 0.5,    // Update priorities every 500ms
  debugLogging: true,             // Enable debug logs
});

// 2. Register textures
const handle = streamingManager.register({
  id: 'character-diffuse',
  url: 'assets/textures/character-diffuse.ktx2',
  category: 'persistent',         // Always loaded
  entity: characterEntity,
  targetLod: 1,                   // High quality
  userPriority: 1.5,              // Boost priority (0-2)
});

// 3. Update every frame
app.on('update', (dt: number) => {
  streamingManager.update(dt);
});
```

## Category System

### Persistent
**Always loaded, never evicted** - UI, player, weapons, etc.

```typescript
streamingManager.register({
  id: 'player-texture',
  url: 'assets/player.ktx2',
  category: 'persistent',
  entity: playerEntity,
  targetLod: 0,  // Full quality
});
```

### Level
**Loaded with level, kept in memory** - Level geometry, static objects

```typescript
streamingManager.register({
  id: 'building-texture',
  url: 'assets/building.ktx2',
  category: 'level',
  entity: buildingEntity,
  targetLod: 2,  // Medium quality
});
```

### Dynamic
**Distance-based streaming** - World objects, NPCs, props

```typescript
streamingManager.register({
  id: 'tree-texture',
  url: 'assets/tree.ktx2',
  category: 'dynamic',
  entity: treeEntity,
  targetLod: 5,  // Base quality
});
```

## Configuration

### Global Config

```typescript
streamingManager.setConfig({
  maxMemoryMB: 768,              // Increase budget to 768MB
  maxConcurrent: 6,               // Allow 6 parallel loads
  priorityUpdateInterval: 0.3,    // Update more frequently
  debugLogging: true,
  logPriorityChanges: true,       // Log priority recalculations
});
```

### Category Config

```typescript
// Make dynamic textures higher quality
streamingManager.setCategoryConfig('dynamic', {
  targetLod: 3,           // Better quality
  priorityWeight: 150,    // Higher priority
  loadImmediately: true,  // Auto-load on register
});

// Apply presets
const categoryManager = streamingManager.getCategoryConfig('level');
```

## Manual Control

### Load/Unload

```typescript
// Force load a texture
streamingManager.requestLoad('building-texture', 1000); // priority=1000

// Unload to free memory
streamingManager.requestUnload('distant-texture');
```

### Priority Override

```typescript
// Boost priority (0-2, default 1)
streamingManager.setUserPriority('boss-texture', 2.0);  // Max priority
streamingManager.setUserPriority('background-texture', 0.5);  // Low priority
```

### Bulk Operations

```typescript
// Unregister category (e.g., when changing levels)
streamingManager.unregisterCategory('level');

// Unregister entity textures
streamingManager.unregisterEntity(oldEntity);
```

## Statistics & Debug

### Get Stats

```typescript
const stats = streamingManager.getStats();

console.log('Memory:', {
  used: stats.memoryUsed / 1024 / 1024,   // MB
  limit: stats.memoryLimit / 1024 / 1024, // MB
  usage: stats.memoryUsagePercent,        // %
});

console.log('Loading:', {
  active: stats.activeLoads,
  queued: stats.queued,
  avgTime: stats.averageLoadTime,
});

console.log('Categories:', stats.categoryStats);
```

### Debug Console

```typescript
// Print comprehensive debug info
streamingManager.debug();

// Output:
// [TextureStreamingManager] Debug Info
//   Configuration: { maxMemoryMB: 512, ... }
//   Textures: { total: 45, loaded: 32, ... }
//   Memory: { used: "245.32 MB", limit: "512.00 MB", ... }
//   Loading: { active: 2, queued: 8, avgTime: "342ms" }
//   Categories: { persistent: {...}, level: {...}, dynamic: {...} }
```

### Individual Texture Info

```typescript
const handle = streamingManager.getHandle('character-diffuse');

console.log({
  state: handle.state,          // 'loaded', 'loading', etc.
  priority: handle.priority,    // Current priority value
  currentLod: handle.currentLod, // Current LOD level
  targetLod: handle.targetLod,   // Target LOD level
  memoryUsage: handle.getMemoryUsage(), // Bytes
});
```

## Advanced Usage

### Custom Priority Calculation

Priority is calculated as:
```
priority = (1 / (1 + distance * 0.1)) * categoryWeight * userWeight * distanceWeight
```

- **distance**: Distance from camera to entity (meters)
- **categoryWeight**: From category config (persistent=1000, level=500, dynamic=100)
- **userWeight**: User override (0-2, default 1)
- **distanceWeight**: Global scaling factor (default 1000)

### Memory Management

The system automatically evicts textures when memory pressure is high:

- **None** (< 60%): No action
- **Low** (60-75%): Monitor
- **Medium** (75-85%): Warn
- **High** (85-95%): Auto-evict to 70%
- **Critical** (> 95%): Aggressive eviction to 60%

Eviction uses hybrid LRU + priority:
```
evictionScore = priority * 0.7 + recency * 0.3
```

### Integration Example

```typescript
import { TextureStreamingManager } from './streaming';

class Game {
  private streamingManager: TextureStreamingManager;

  initialize(app: pc.Application) {
    // Initialize streaming
    this.streamingManager = new TextureStreamingManager(app, {
      maxMemoryMB: 512,
      maxConcurrent: 4,
      debugLogging: true,
    });

    // Update loop
    app.on('update', (dt) => {
      this.streamingManager.update(dt);
    });

    // Cleanup on destroy
    app.on('destroy', () => {
      this.streamingManager.destroy();
    });
  }

  loadLevel(levelName: string) {
    // Clear previous level
    this.streamingManager.unregisterCategory('level');

    // Load new level textures
    for (const asset of levelAssets) {
      this.streamingManager.register({
        id: asset.id,
        url: asset.url,
        category: 'level',
        entity: asset.entity,
        targetLod: 2,
      });
    }
  }

  spawnEnemy(entity: pc.Entity) {
    // Register enemy texture
    this.streamingManager.register({
      id: `enemy-${entity.getGuid()}`,
      url: 'assets/enemy.ktx2',
      category: 'dynamic',
      entity: entity,
      userPriority: 1.2, // Slightly higher priority
    });
  }

  getStats() {
    return this.streamingManager.getStats();
  }
}
```

## Performance Tips

1. **Category Assignment**
   - Use `persistent` sparingly (UI, player)
   - Use `level` for static geometry
   - Use `dynamic` for distance-based objects

2. **Memory Budget**
   - Desktop: 512-1024 MB
   - Mobile: 256-512 MB
   - Set per-category limits for better control

3. **LOD Strategy**
   - Persistent: LOD 0-1 (high quality)
   - Level: LOD 2-3 (medium quality)
   - Dynamic: LOD 5-7 (base quality)

4. **Priority Updates**
   - 0.5s interval for 60 FPS (default)
   - 0.3s for fast-moving games
   - 1.0s for slower games

5. **Concurrent Loads**
   - 4 concurrent loads (default)
   - Increase for better throughput
   - Decrease for bandwidth-constrained scenarios

## Troubleshooting

### Textures not loading
```typescript
// Check registration
const handle = streamingManager.getHandle('texture-id');
console.log(handle?.state); // Should be 'queued' or 'loading'

// Check queue
const stats = streamingManager.getStats();
console.log(stats.queued, stats.loading);
```

### Memory issues
```typescript
// Check memory pressure
const stats = streamingManager.getStats();
console.log(stats.memoryUsagePercent);

// Manually evict
streamingManager.requestUnload('large-texture-id');
streamingManager.unregisterCategory('dynamic');
```

### Priority issues
```typescript
// Enable priority logging
streamingManager.setConfig({
  logPriorityChanges: true,
});

// Manually boost priority
streamingManager.setUserPriority('important-texture', 2.0);
```

## API Reference

See `types.ts` for complete type definitions.

### Main Methods
- `register(options)` - Register texture
- `unregister(id)` - Remove texture
- `update(dt)` - Update system (call every frame)
- `setConfig(config)` - Update configuration
- `setCategoryConfig(category, config)` - Update category
- `requestLoad(id, priority?)` - Force load
- `requestUnload(id)` - Force unload
- `setUserPriority(id, priority)` - Override priority
- `getStats()` - Get statistics
- `debug()` - Print debug info
- `destroy()` - Cleanup

### Events
The system doesn't emit events directly, but you can monitor state changes via:
- `handle.state` - Texture state
- `streamingManager.getStats()` - System statistics

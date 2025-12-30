# Asset Streaming Architecture

This document describes the asset streaming systems for loading external assets in PlayCanvas.

## Overview

The library provides two streaming systems:

| System | Status | Use Case |
|--------|--------|----------|
| **ProcessedAssetManager** | ✅ Recommended | PlaycanvasAssetProcessor output, templates with excluded assets |
| **StreamingManager** | ⚠️ Deprecated | Simple manifests, legacy projects |

## ProcessedAssetManager (Recommended)

The new system designed for use with [PlaycanvasAssetProcessor](https://github.com/SashaRX/PlaycanvasAssetProcessor).

### Features

- **mapping.json** - Loads mapping from PlaycanvasAssetProcessor
- **Asset ID Registration** - Registers assets with original PlayCanvas IDs for templates
- **LOD Models** - Distance-based LOD switching
- **Material Instances** - Clone master + apply JSON params (no shader recompile)
- **ORM Textures** - Packed textures with channel mapping (R=AO, G=Roughness, B=Metalness)
- **KTX2 Progressive** - Mip-by-mip texture loading

### Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. mapping.json loaded                                                  │
│     ↓                                                                    │
│  2. AssetRegistrar registers placeholder assets with original IDs       │
│     (enables template asset references: app.assets.get(12345))          │
│     ↓                                                                    │
│  3. Template instantiated - finds registered asset IDs                   │
│     ↓                                                                    │
│  4. LodManager starts loading LOD2 (fastest to display)                 │
│     ↓                                                                    │
│  5. Camera moves → LOD switching based on distance                      │
│     ↓                                                                    │
│  6. Materials loaded as instances (clone master + apply params)          │
│     ↓                                                                    │
│  7. Textures loaded progressively (mip-by-mip)                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### mapping.json Format

```json
{
  "baseUrl": "https://cdn.example.com/assets",
  "version": "1.0.0",
  "models": {
    "12345": {
      "name": "building",
      "materials": [67890, 67891],
      "lods": [
        { "level": 0, "file": "models/building_lod0.glb", "distance": 0 },
        { "level": 1, "file": "models/building_lod1.glb", "distance": 20 },
        { "level": 2, "file": "models/building_lod2.glb", "distance": 50 }
      ]
    }
  },
  "materials": {
    "67890": "materials/concrete.json"
  }
}
```

### Material Instance JSON

```json
{
  "master": "pbr_opaque",
  "params": {
    "diffuse": [0.8, 0.7, 0.6],
    "metalness": 0.0,
    "gloss": 0.7
  },
  "textures": {
    "diffuseMap": { "asset": 11111 },
    "normalMap": { "asset": 22222 },
    "aoMap": {
      "path": "textures/concrete_orm.ktx2",
      "ao": "r",
      "roughness": "g",
      "metalness": "b"
    }
  }
}
```

### Usage

```typescript
import { ProcessedAssetManager } from 'ktx2-progressive-loader';

const manager = new ProcessedAssetManager(app, {
  mappingUrl: 'https://cdn.example.com/mapping.json',
  baseUrl: 'https://cdn.example.com/assets',
  libktxMjsUrl: 'https://cdn.example.com/libktx.mjs',
  libktxWasmUrl: 'https://cdn.example.com/libktx.wasm',
  meshoptUrl: 'https://cdn.example.com/meshopt_decoder.mjs',
  masterMaterialPrefix: 'Master_',
  debug: true,
});

await manager.initialize();

// Load model with all LODs and materials
await manager.loadModel(12345);

// Templates now work - they find registered asset IDs
const template = app.assets.find('Building', 'template');
const instance = template.resource.instantiate();
```

## Components

### MappingLoader

Loads and parses mapping.json. Provides lookups for models, materials, LODs.

```typescript
const loader = MappingLoader.getInstance();
await loader.load('https://cdn.example.com/mapping.json');

const model = loader.getModel('12345');
const lodUrl = loader.getLodUrl('12345', 0);
const materialUrl = loader.getMaterialUrl('67890');
```

### AssetRegistrar

Registers assets with original PlayCanvas IDs. Critical for templates.

```typescript
const registrar = new AssetRegistrar(app, mapping);

// Register all assets from mapping
registrar.registerAll();

// Now templates work
const asset = app.assets.get(12345); // Returns registered asset
```

**Key insight:** `asset.id` is writable in PlayCanvas. This allows registering assets with specific IDs that templates expect.

### LodManager

Distance-based LOD switching for models.

```typescript
const manager = new LodManager(app, mapping, lodLoader);
manager.findCamera();
manager.start();

// Register entity for LOD updates
manager.registerEntity(entity, '12345');
```

### MaterialInstanceLoader

Loads material instances from JSON, clones master materials.

```typescript
const loader = new MaterialInstanceLoader(app, mapping);
loader.registerMastersFromAssets('Master_');

const material = await loader.load('67890');
// Returns cloned master with applied params
```

### OrmTextureHandler

Handles packed ORM (Occlusion/Roughness/Metalness) textures.

```typescript
const handler = new OrmTextureHandler();

handler.applyOrmTexture(material, texture, {
  path: 'textures/orm.ktx2',
  ao: 'r',
  roughness: 'g',
  metalness: 'b',
});
```

## StreamingManager (Deprecated)

Legacy system for simpler use cases.

### When to Use

- Simple manifest.json format (not PlaycanvasAssetProcessor)
- Single LOD per model
- Direct material loading (not instances)
- No template support needed

### Usage

```typescript
import { StreamingManager, AssetManifest } from 'ktx2-progressive-loader';

// Load manifest
const manifest = AssetManifest.getInstance();
await manifest.load('https://example.com/manifest.json');

// Create manager
const manager = new StreamingManager(app, {
  manifestUrl: 'https://example.com/manifest.json',
});

await manager.initialize();
```

## File Structure

```
src/streaming/
├── ProcessedAssetManager.ts  # Main coordinator (new system)
├── MappingLoader.ts          # mapping.json loader
├── MappingTypes.ts           # Type definitions
├── AssetRegistrar.ts         # Asset ID registration
├── MaterialInstanceLoader.ts # Material instance loading
├── OrmTextureHandler.ts      # ORM texture handling
├── LodManager.ts             # LOD switching
├── CacheManager.ts           # IndexedDB caching (shared)
├── StreamingManager.ts       # [DEPRECATED] Legacy coordinator
├── AssetManifest.ts          # [DEPRECATED] Legacy manifest
├── types.ts                  # Legacy types
├── types-extended.ts         # Extended types (LOD, etc.)
├── index.ts                  # Exports
└── loaders/
    ├── LodModelLoader.ts     # LOD model loading
    ├── ModelLoader.ts        # [DEPRECATED] Single LOD
    ├── MaterialLoader.ts     # Material loading
    ├── TextureLoader.ts      # Texture loading
    └── index.ts
```

## Migration from StreamingManager

1. Generate mapping.json with PlaycanvasAssetProcessor
2. Upload processed assets to CDN
3. Replace StreamingManager with ProcessedAssetManager
4. Update initialization code:

```typescript
// Before (deprecated)
const manifest = AssetManifest.getInstance();
await manifest.load(manifestUrl);
const manager = new StreamingManager(app, config);

// After (recommended)
const manager = new ProcessedAssetManager(app, {
  mappingUrl: 'https://cdn.example.com/mapping.json',
  baseUrl: 'https://cdn.example.com/assets',
  // ... other config
});
await manager.initialize();
```

## Caching

Both systems use `CacheManager` for IndexedDB caching:

- Models cached as ArrayBuffer
- Textures cached per mip level
- Version-based invalidation
- Automatic cleanup of old versions

```typescript
const cache = CacheManager.getInstance();
await cache.init();

// Manual cache control
await cache.clear(); // Clear all
cache.removeFromMemory('model:12345'); // Remove from memory only
```

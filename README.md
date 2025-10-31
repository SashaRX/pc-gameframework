# KTX2 Progressive Loader for PlayCanvas

Progressive texture loading system with adaptive quality, HTTP range requests, and IndexedDB caching for PlayCanvas Engine.

## ✨ Features

- 🎯 **Progressive Loading** - Load textures from low to high resolution
- 📡 **HTTP Range Requests** - Download only needed mipmap levels
- 🎨 **Adaptive Quality** - Automatically select resolution based on screen size
- 💾 **IndexedDB Caching** - Cache transcoded mipmaps for instant reloading
- ⚡ **FPS Throttling** - Non-blocking loading with frame rate control
- 🔍 **Verbose Logging** - Detailed statistics and progress tracking
- 🎮 **PlayCanvas Editor** - Full integration with Editor workflow

## 🚀 Quick Start

### 1. Setup PlayCanvas Sync

This project uses [playcanvas-sync][playcanvas-sync] to upload code to PlayCanvas Editor.

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure PlayCanvas Sync:**
   - Copy `.pcconfig` to your home directory (Mac: `/Users/<username>`, Windows: `C:/Users/<username>`)
   - Copy `pcconfig.template.json` → `pcconfig.json`
   - Fill in your project details in `pcconfig.json`:
     - `PLAYCANVAS_API_KEY` - [Create API key][create-api-key]
     - `PLAYCANVAS_PROJECT_ID` - [Find project ID][find-project-id]
     - `PLAYCANVAS_BRANCH_ID` - [Find branch ID][find-branch-id]

3. **Build and upload:**
   ```bash
   npm run build-push:debug
   ```

### 2. Upload Assets to PlayCanvas Editor

**Two integration options available:**

#### Option A: ESM Scripts (Recommended ✨)

Upload these files from `build/esm/` folder:

- ✅ `Ktx2LoaderScript.mjs` - Main script (ESM format)
- ✅ `ktx2-loader/` - Loader modules folder (all .js files)
- ✅ `libktx.mjs` - KTX transcoding library
- ✅ `libktx.wasm` - WASM binary

**In PlayCanvas Editor:**
- `Ktx2LoaderScript.mjs` → Type: **Script**
- All `.js` files in `ktx2-loader/` → Type: **Script**
- `libktx.mjs` → Type: **Script**
- `libktx.wasm` → Type: **Binary**

#### Option B: AMD Bundle (Legacy)

Upload from `build/` folder:

- ✅ `main.bundle.js` - Single bundle file (auto-uploaded by playcanvas-sync)
- ✅ `libktx.mjs` - KTX transcoding library
- ✅ `libktx.wasm` - WASM binary

### 3. Add Script to Entity

1. **Create or select an Entity** in your scene (e.g., a plane or cube with a model)
2. **Add Script Component** to the entity
3. **Add Script** → Select **"ktx2Loader"**
4. **Configure attributes** in Inspector:
   - **KTX2 URL**: URL to your `.ktx2` file (e.g., `https://example.com/texture.ktx2`)
   - **Progressive Loading**: ✅ Enable for progressive loading
   - **Verbose Logging**: ✅ Enable to see detailed logs in console
   - **Enable Cache**: ✅ Cache transcoded mipmaps in IndexedDB
   - **Adaptive Loading**: ⬜ Enable to stop at screen resolution

### 4. Test

Press **Launch** in PlayCanvas Editor and check the browser console for logs:

```
[KTX2] Initializing loader...
[KTX2] Loader ready
[KTX2] Probing: https://example.com/texture.ktx2
[KTX2] HEAD response: { fileSize: "4.25 MB", supportsRanges: true }
[KTX2] Probe complete: { size: "2048x2048", levels: 12, ... }
[KTX2] Repacked level 11: { dimensions: "1x1", ... }
[KTX2] Uploaded level 11 to GPU: 1x1 (4.00 KB)
...
[KTX2] Loading complete: { totalTime: "2.34s", levelsLoaded: 12, ... }
```

## 📖 Usage Examples

### Basic Usage (Script Component)

Attach the `ktx2Loader` script to any entity with a model component:

```javascript
// No code needed! Configure via Inspector attributes
```

### Programmatic Usage

```typescript
import { Ktx2ProgressiveLoader } from './ktx2-loader/Ktx2ProgressiveLoader';

// Create loader
const loader = new Ktx2ProgressiveLoader(app, {
  ktxUrl: 'https://example.com/texture.ktx2',
  progressive: true,
  isSrgb: false,
  verbose: true,
  enableCache: true,
  adaptiveLoading: false,
  stepDelayMs: 150,
});

// Initialize
await loader.initialize(
  app.assets.find('libktx.mjs').getFileUrl(),
  app.assets.find('libktx.wasm').getFileUrl()
);

// Load texture to entity
const texture = await loader.loadToEntity(entity, {
  onProgress: (level, total, info) => {
    console.log(`Loading: ${level}/${total} - ${info.width}x${info.height}`);
  },
  onComplete: (stats) => {
    console.log('Done!', stats);
  },
});

// Cleanup when done
loader.dispose();
```

## 🛠️ Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ktxUrl` | `string` | *required* | URL to KTX2 file |
| `progressive` | `boolean` | `true` | Enable progressive loading |
| `isSrgb` | `boolean` | `false` | Treat as sRGB (for albedo/diffuse) |
| `verbose` | `boolean` | `true` | Enable detailed logging |
| `enableCache` | `boolean` | `true` | Cache in IndexedDB |
| `useWorker` | `boolean` | `true` | Use Web Worker (TODO) |
| `adaptiveLoading` | `boolean` | `false` | Stop at screen resolution |
| `adaptiveMargin` | `number` | `1.5` | Adaptive quality margin |
| `stepDelayMs` | `number` | `150` | Delay between mipmap loads |
| `minFrameInterval` | `number` | `16` | Min ms between frames (60fps) |
| `maxRgbaBytes` | `number` | `64MB` | Max RGBA memory allowed |
| `cacheMaxAgeDays` | `number` | `7` | Cache TTL in days |

## 📦 Creating KTX2 Files

Use [toktx](https://github.com/KhronosGroup/KTX-Software) from KTX-Software:

```bash
# BasisLZ supercompression (universal)
toktx --bcmp --genmipmap texture.ktx2 input.png

# UASTC (higher quality)
toktx --uastc --uastc_quality 2 --genmipmap texture.ktx2 input.png

# Test HTTP Range support
curl -I https://your-server.com/texture.ktx2
# Should return: Accept-Ranges: bytes
```

**Recommended hosting:** CDN with HTTP Range support (Cloudflare, AWS S3, Vercel, etc.)

## 🐛 Troubleshooting

### "libktx not initialized"
- Ensure `libktx.mjs` and `libktx.wasm` are uploaded to PlayCanvas assets
- Check that files are accessible via `app.assets.find('libktx.mjs')`

### "HEAD request failed"
- Server doesn't support HEAD requests → Loader will fallback to GET
- Not critical, just less efficient

### "Range request failed"
- Server doesn't support HTTP Range header → Loader downloads full file
- Still works, but loses progressive benefit

### "Failed to project to screen space"
- No camera in scene → Adaptive loading disabled
- Entity has no mesh → Adaptive loading disabled

## 🧪 Development

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run build:debug` | Compile TypeScript (debug) |
| `npm run build:release` | Compile TypeScript (release) |
| `npm run watch:debug` | Watch mode (debug) |
| `npm run push` | Upload to PlayCanvas |
| `npm run watch-push:debug` | Watch + auto-upload |

### Project Structure

```
ktx2-progressive-loader-esm/
├── src/
│   ├── ktx2-loader/
│   │   ├── Ktx2ProgressiveLoader.ts  # Main loader
│   │   ├── KtxCacheManager.ts        # IndexedDB cache
│   │   ├── types.ts                  # TypeScript types
│   │   └── utils/
│   │       ├── alignment.ts          # KTX2 alignment helpers
│   │       └── colorspace.ts         # DFD parsing
│   ├── scripts/
│   │   └── Ktx2LoaderScript.ts       # PlayCanvas script component
│   └── index.ts                      # Entry point
├── build/
│   ├── main.bundle.js                # Compiled output
│   ├── libktx.mjs                    # Transcoding library
│   └── libktx.wasm                   # WASM binary
└── lib/                              # Source libraries
```

## 📝 Implementation Status

### ✅ Milestone B - Core Functionality (COMPLETE)
- ✅ B.1: HTTP Range requests + KTX2 header parsing
- ✅ B.2: Mini-KTX2 repack for single levels
- ✅ B.3: Adaptive loading strategy
- ✅ B.4: Progressive loading loop
- ✅ B.5: Transcoding + GPU upload

### 🚧 Milestone C - Performance (TODO)
- ⏳ C.1: Web Worker for transcoding
- ⏳ C.2: Enhanced FPS throttling
- ⏳ C.3: Extended cache features
- ⏳ C.4: HEAPU8 memory monitoring

### 🔮 Milestone E - Advanced (TODO)
- ⏳ E.1: Hardware compressed formats (ETC, ASTC, BC)
- ⏳ E.2: WebGPU backend support

## 🤝 Contributing

See [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html) for format details.

## 📚 References

- [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [KTX-Software Tools](https://github.com/KhronosGroup/KTX-Software)
- [PlayCanvas Engine](https://playcanvas.com/)
- [Basis Universal](https://github.com/BinomialLLC/basis_universal)

## Additional Notes

⚠️ **Important:** When adding new `pc.ScriptTypes` or modifying script attributes, you must manually **Parse** the script in PlayCanvas Editor. [Read more][playcanvas-sync-new-script-types].

## npm scripts

| Command                      | Description                                                                                  |
|------------------------------|----------------------------------------------------------------------------------------------|
| `npm run build:debug`        | Compiles tsc files using debug config and builds to `build/main.bundle.js`                   |
| `npm run build:release`      | Compiles tsc files using release config and builds to `build/main.bundle.js`                 |
| `npm run watch:debug`        | Compiles tsc files using debug config on code changes and builds to `build/main.bundle.js`   |
| `npm run watch:release`      | Compiles tsc files using release config on code changes and builds to `build/main.bundle.js` |
| `npm run push`               | Uploads `build/main.bundle.js` to playcanvas.com project                                     |
| `npm run build-push:debug`   | Performs `build:debug` and `push` npm scripts                                                |
| `npm run build-push:release` | Performs `build:release` and `push` npm scripts                                              |
| `npm run watch-push:debug`   | Performs `watch:debug` and `push` npm scripts                                                |
| `npm run watch-push:release` | Performs `watch:release` and `push` npm scripts                                              |

[playcanvas-sync]: https://github.com/playcanvas/playcanvas-sync
[playcanvas-sync-pcconfig-instructions]: https://github.com/playcanvas/playcanvas-sync#config-variables
[playcanvas-sync-new-script-types]: https://github.com/playcanvas/playcanvas-sync#adding-new-files-as-script-components
[create-api-key]: https://developer.playcanvas.com/user-manual/api/#authorization
[find-project-id]: https://developer.playcanvas.com/user-manual/api/#project_id
[find-branch-id]: https://developer.playcanvas.com/user-manual/api/#branch_id

# KTX2 Progressive Loader for PlayCanvas

Complete texture streaming solution for PlayCanvas Engine 2.12.4+ with progressive loading, memory management, and hardware-compressed format support.

## 🎯 Two Usage Modes

### 1. Simple Mode (Single Texture)
Use `Ktx2LoaderScript` for loading individual textures progressively.
- Perfect for simple cases and testing
- Easy to configure via Inspector
- See [Quick Start ESM](QUICK_START_ESM.md)

### 2. Advanced Mode (Texture Streaming Manager)
Use `StreamingManagerScript` for managing multiple textures with priority-based loading.
- Automatic memory management
- Distance-based priority
- Category-based streaming policies
- See [Streaming Quick Start](STREAMING_QUICK_START.md)

## ✨ Features

### Core Capabilities
- ✅ Progressive loading from low to high resolution
- ✅ HTTP Range requests for partial downloads
- ✅ Hardware compressed texture formats (BC1-7, ETC1/2, ASTC, PVRTC)
- ✅ Adaptive quality based on screen size
- ✅ IndexedDB caching with TTL
- ✅ Web Worker transcoding (non-blocking)
- ✅ FPS throttling and pause/resume API

### Streaming Manager
- ✅ Priority-based multi-texture streaming
- ✅ Memory budget management with automatic eviction
- ✅ Category system (persistent/level/dynamic)
- ✅ Distance-based priority calculation
- ✅ LRU cache with memory pressure handling
- ✅ Real-time statistics and monitoring

### Production Ready
- ✅ External URL support (no bundling required)
- ✅ Custom shader chunks for progressive LOD
- ✅ Anisotropic filtering
- ✅ Supports ETC1S (BasisLZ) and UASTC formats
- ✅ Comprehensive error handling

## 🚀 Quick Start

### Mode 1: Simple Single Texture Loading

Perfect for testing or loading individual textures:

```bash
# 1. Build
npm install
npm run build:esm

# 2. Upload to PlayCanvas
# Upload files from build/esm/:
# - scripts/Ktx2LoaderScript.mjs
# - ktx2-loader/*.mjs
# - streaming/*.mjs (optional, for streaming)

# 3. Add script to entity with model component
# 4. Configure in Inspector:
#    - ktxUrl: https://example.com/texture.ktx2
#    - libktxMjsUrl: https://raw.githubusercontent.com/.../libktx.mjs
#    - libktxWasmUrl: https://raw.githubusercontent.com/.../libktx.wasm
```

See [Quick Start ESM](QUICK_START_ESM.md) for detailed instructions.

### Mode 2: Texture Streaming Manager

For managing multiple textures in open-world games:

```bash
# 1. Add StreamingManager to scene (empty entity)
# 2. Configure memory budget and quality preset
# 3. Add StreamedTexture scripts to objects
# 4. Set categories: persistent / level / dynamic
```

See [Streaming Quick Start](STREAMING_QUICK_START.md) for detailed guide.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| ktxUrl | string | required | URL to KTX2 file |
| libktxMjsUrl | string | optional | External URL for libktx.mjs |
| libktxWasmUrl | string | optional | External URL for libktx.wasm |
| progressive | boolean | true | Enable progressive loading |
| isSrgb | boolean | false | sRGB color space |
| verbose | boolean | true | Detailed logging |
| enableCache | boolean | true | IndexedDB cache |
| useWorker | boolean | true | Web Worker transcoding |
| adaptiveLoading | boolean | false | Stop at screen resolution |
| stepDelayMs | number | 150 | Delay between levels (ms) |
| enableAniso | boolean | true | Anisotropic filtering |
| adaptiveThrottling | boolean | false | Auto-adjust delays based on FPS |
| targetFps | number | 60 | Target frame rate for throttling |
| minStepDelayMs | number | 0 | Min delay when FPS high |
| maxStepDelayMs | number | 500 | Max delay when FPS low |

### External URLs

Using external URLs avoids 403 errors in PlayCanvas published builds.

Recommended:
- libktxMjsUrl: `https://raw.githubusercontent.com/SashaRX/ktx-host/refs/heads/main/libktx.mjs`
- libktxWasmUrl: `https://raw.githubusercontent.com/SashaRX/ktx-host/refs/heads/main/libktx.wasm`

## Creating KTX2 Files

```bash
# BasisLZ (ETC1S)
toktx --bcmp --genmipmap texture.ktx2 input.png

# UASTC (higher quality)
toktx --uastc --uastc_quality 2 --genmipmap texture.ktx2 input.png
```

Requires HTTP Range support on server (CDN, S3, etc).

## Build Commands

| Command | Description |
|---------|-------------|
| `npm run build:esm` | Build ESM modules |
| `npm run build:clean` | Clean build + rebuild |
| `npm run watch:esm` | Watch mode ESM |
| `npm run push` | Upload to PlayCanvas |
| `npm run build-push:esm` | Build + upload |

## 📦 Project Structure

```
src/
├── ktx2-loader/                          # Core KTX2 loader
│   ├── Ktx2ProgressiveLoader.ts         # Main progressive loader
│   ├── LibktxLoader.ts                  # External URL loader
│   ├── KtxCacheManager.ts               # IndexedDB caching
│   ├── GpuFormatDetector.ts             # Hardware format detection
│   ├── MemoryPool.ts                    # Memory buffer pooling
│   ├── types.ts                         # TypeScript interfaces
│   └── utils/
│       ├── alignment.ts                 # KTX2 alignment helpers
│       └── colorspace.ts                # DFD & colorspace parsing
│
├── streaming/                            # Multi-texture streaming system
│   ├── TextureStreamingManager.ts       # Main orchestrator
│   ├── TextureHandle.ts                 # Individual texture wrapper
│   ├── TextureRegistry.ts               # Central texture storage
│   ├── CategoryManager.ts               # Category configs
│   ├── MemoryTracker.ts                 # Memory budget & eviction
│   ├── SimpleScheduler.ts               # Priority queue & loading
│   ├── PriorityQueue.ts                 # Priority heap
│   └── types.ts                         # Streaming interfaces
│
├── scripts/                              # PlayCanvas scripts
│   ├── Ktx2LoaderScript.ts              # Simple single-texture loader
│   ├── StreamingManagerScript.ts        # Global streaming manager
│   └── StreamedTextureScript.ts         # Per-object texture registration
│
├── workers/                              # Web Workers
│   └── ktx-transcode.worker.ts          # Background transcoding
│
build/esm/                                # Compiled ESM modules
├── scripts/
│   ├── Ktx2LoaderScript.mjs
│   ├── StreamingManagerScript.mjs
│   └── StreamedTextureScript.mjs
├── ktx2-loader/                          # Core loader modules
├── streaming/                            # Streaming system modules
└── workers/                              # Inline worker code
```

## 🎯 Implementation Status

### ✅ Phase 1-3: Core & Performance (100% Complete)
- ✅ HTTP Range requests + KTX2 header parsing
- ✅ Mini-KTX2 repack for single levels (ETC1S + UASTC)
- ✅ SGD repacking for ETC1S
- ✅ Progressive loading with LOD clamping
- ✅ GPU upload with WebGL2
- ✅ Custom shader chunks
- ✅ Adaptive loading based on screen size
- ✅ IndexedDB caching with TTL & LRU
- ✅ Anisotropic filtering
- ✅ External URL support (LibktxLoader)
- ✅ Web Worker transcoding (non-blocking)
- ✅ Enhanced FPS throttling with RAF
- ✅ Pause/resume API
- ✅ Memory pool & full KTX2 assembly
- ✅ Advanced cache statistics

### ✅ Phase 4.1: Hardware Compressed Formats (100% Complete)
- ✅ GPU capabilities detection
- ✅ BC1-BC7 (Desktop: DirectX)
- ✅ ETC1/ETC2 (Mobile: OpenGL ES)
- ✅ ASTC (Modern mobile & desktop)
- ✅ PVRTC (iOS legacy)
- ✅ Automatic format selection
- ✅ Direct compressed texture upload
- ✅ Alpha channel detection from DFD
- ✅ 4-8x GPU memory savings

### ✅ Phase 4.2: Texture Streaming Manager (100% Complete)
- ✅ Multi-texture priority system
- ✅ Category-based streaming (persistent/level/dynamic)
- ✅ Memory budget management
- ✅ Distance-based priority calculation
- ✅ Automatic texture eviction (LRU + priority)
- ✅ Memory pressure levels
- ✅ Quality presets (mobile/balanced/high-quality)
- ✅ Real-time statistics & monitoring
- ✅ PlayCanvas script integration

### 🔮 Future Enhancements
- ⏳ Streaming decode within single level
- ⏳ WebGPU backend support
- ⏳ Worker pool for parallel textures

See [MILESTONES.md](MILESTONES.md) for detailed roadmap.

## Troubleshooting

**403 Forbidden or libktx not initialized**
- Use external URLs for libktx files
- Set libktxMjsUrl and libktxWasmUrl in Inspector

**CORS policy error**
- Wrong: `github.com/.../file?raw=1` (redirects)
- Correct: `raw.githubusercontent.com/.../file` (direct)

**Range request failed**
- Server doesn't support HTTP Range header
- Falls back to full file download

**Pixelated texture**
- Check console for LOD window updates
- Verify all mip levels loaded

**Script attributes not visible**
- Use ESM Script format with @attribute JSDoc
- Refresh PlayCanvas Editor

**Memory issues**
- Reduce texture size or disable cache
- Increase stepDelayMs

## 📚 Documentation

- [Quick Start ESM](QUICK_START_ESM.md) - Simple single texture loading
- [Streaming Quick Start](STREAMING_QUICK_START.md) - Multi-texture streaming setup
- [Streaming Usage Guide](STREAMING_USAGE.md) - Complete API reference
- [Implementation Summary](IMPLEMENTATION_SUMMARY.md) - Technical details
- [Milestones](MILESTONES.md) - Development roadmap
- [Setup Guide](SETUP_GUIDE.md) - PlayCanvas integration

## 🔗 References

- [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [KTX-Software Tools](https://github.com/KhronosGroup/KTX-Software)
- [PlayCanvas Engine](https://playcanvas.com/)
- [Basis Universal](https://github.com/BinomialLLC/basis_universal)
- [WebGL Compressed Textures](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Compressed_texture_formats)

---

**Status:** Production Ready 🚀
**License:** MIT
**Maintained by:** SashaRX

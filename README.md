# KTX2 Progressive Loader for PlayCanvas

Progressive texture loading for PlayCanvas Engine 2.12.4+ with HTTP range requests, IndexedDB caching, and adaptive quality.

## Features

- Progressive loading from low to high resolution
- HTTP Range requests for partial downloads
- Adaptive quality based on screen size
- IndexedDB caching for transcoded mipmaps
- FPS throttling for non-blocking loading
- External URL support (no bundling required)
- Custom shader chunks for progressive LOD clamping
- Anisotropic filtering support
- Supports ETC1S (BasisLZ) and UASTC formats
- Production-ready for published builds

## Quick Start

### 1. Build

```bash
npm install
npm run build:esm
```

### 2. Upload to PlayCanvas

Upload from `build/esm/`:

- `scripts/Ktx2LoaderScript.mjs` - Type: Script
- `ktx2-loader/*.mjs` - Type: Script (all files in folder)

Note: libktx files are loaded from external URLs, no need to upload them.

### 3. Add Script to Entity

1. Select entity with model or render component
2. Add Script Component
3. Add Script: "ktx2Loader"
4. Configure attributes in Inspector:
   - ktxUrl: `https://example.com/texture.ktx2`
   - libktxMjsUrl: `https://raw.githubusercontent.com/SashaRX/ktx-host/refs/heads/main/libktx.mjs`
   - libktxWasmUrl: `https://raw.githubusercontent.com/SashaRX/ktx-host/refs/heads/main/libktx.wasm`
   - progressive: true
   - verbose: true
   - enableCache: true

### 4. Test

Press Launch and check console for logs.

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

## Project Structure

```
src/
├── ktx2-loader/
│   ├── Ktx2ProgressiveLoader.ts  # Main loader
│   ├── LibktxLoader.ts           # External URL loader (NEW)
│   ├── KtxCacheManager.ts        # IndexedDB cache
│   ├── types.ts                  # TypeScript types
│   └── utils/
│       ├── alignment.ts          # KTX2 alignment
│       └── colorspace.ts         # DFD parsing
├── scripts/
│   └── Ktx2LoaderScript.ts       # PlayCanvas ESM script
build/esm/                         # Compiled output (7 files)
```

## Implementation Status

### Complete
- HTTP Range requests + KTX2 header parsing
- Mini-KTX2 repack for single levels (ETC1S + UASTC)
- SGD repacking for ETC1S
- Progressive loading with LOD clamping
- GPU upload with WebGL2
- Custom shader chunks
- Adaptive loading based on screen size
- IndexedDB caching with TTL
- Anisotropic filtering
- External URL support (LibktxLoader)
- PlayCanvas ESM script integration

### In Progress (Phase 3)
- ✅ Web Worker transcoding
- ✅ Enhanced FPS throttling with RAF
- ✅ Pause/resume API
- ✅ Adaptive delay adjustment
- Advanced cache features
- Memory monitoring

### Planned
- Hardware compressed formats (ETC, ASTC, BC7)
- WebGPU backend
- Multi-texture parallelization

See MILESTONES.md for detailed roadmap.

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

## References

- [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [KTX-Software Tools](https://github.com/KhronosGroup/KTX-Software)
- [PlayCanvas Engine](https://playcanvas.com/)
- [Basis Universal](https://github.com/BinomialLLC/basis_universal)

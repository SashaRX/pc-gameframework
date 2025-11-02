# KTX2 Progressive Loader for PlayCanvas

Progressive texture loading for PlayCanvas Engine 2.12.4+ with HTTP range requests, IndexedDB caching, and adaptive quality.

## Features

- Progressive loading from low to high resolution
- HTTP Range requests for partial downloads
- Adaptive quality based on screen size
- IndexedDB caching for transcoded mipmaps
- FPS throttling for non-blocking loading
- Support for ETC1S (BasisLZ) and UASTC formats
- Custom shader chunks for progressive LOD clamping
- Anisotropic filtering support

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
- `libs/libktx/libktx.mjs` - Type: Script
- `libs/libktx/libktx.wasm` - Type: wasm (or binary)

### 3. Add Script to Entity

1. Select entity with model or render component
2. Add Script Component
3. Add Script: "ktx2Loader"
4. Configure:
   - KTX2 URL: `https://example.com/texture.ktx2`
   - Progressive: true
   - Verbose: true
   - Enable Cache: true

### 4. Test

Press Launch and check console for logs.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| ktxUrl | string | required | URL to KTX2 file |
| progressive | boolean | true | Enable progressive loading |
| isSrgb | boolean | false | sRGB color space |
| verbose | boolean | true | Detailed logging |
| enableCache | boolean | true | IndexedDB cache |
| adaptiveLoading | boolean | false | Stop at screen resolution |
| stepDelayMs | number | 150 | Delay between levels (ms) |
| enableAniso | boolean | true | Anisotropic filtering |

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
│   ├── KtxCacheManager.ts        # IndexedDB cache
│   ├── types.ts                  # TypeScript types
│   └── utils/
│       ├── alignment.ts          # KTX2 alignment
│       └── colorspace.ts         # DFD parsing
├── scripts/
│   └── Ktx2LoaderScriptESM.mjs   # PlayCanvas script
build/esm/                        # Compiled output
lib/                              # WASM/JS libraries
```

## Implementation Status

### Working
- HTTP Range requests + KTX2 header parsing
- Mini-KTX2 repack for single levels (ETC1S + UASTC)
- SGD repacking for ETC1S
- Progressive loading with LOD clamping
- GPU upload with WebGL2
- Custom shader chunks
- Adaptive loading
- IndexedDB caching
- Anisotropic filtering

### TODO
- Web Worker transcoding
- Hardware compressed formats (ETC, ASTC, BC)
- WebGPU backend

## Troubleshooting

**"libktx not initialized"**
- Upload `libktx.mjs` and `libktx.wasm` to PlayCanvas assets

**"Range request failed"**
- Server doesn't support HTTP Range header
- Downloads full file (still works, less efficient)

**Pixelated texture after full load**
- Check `[KTX2] Updated LOD window: [0, N]` appears in logs
- Verify all mip levels loaded successfully

## References

- [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [KTX-Software Tools](https://github.com/KhronosGroup/KTX-Software)
- [PlayCanvas Engine](https://playcanvas.com/)
- [Basis Universal](https://github.com/BinomialLLC/basis_universal)

# 🎯 KTX2 Progressive Loader - Milestones & Roadmap

**Last Updated:** 2025-01-04
**Current Status:** ✅ Production Ready (Phase 1 Complete)

---

## 📊 Overview

| Phase | Status | Completion | Priority |
|-------|--------|------------|----------|
| Phase 1: Core Implementation | ✅ Complete | 100% | Critical |
| Phase 2: Production Deployment | ✅ Complete | 100% | Critical |
| Phase 3: Performance Optimization | ⏳ In Progress | 25% | High |
| Phase 4: Advanced Features | 🔮 Future | 0% | Medium |
| Phase 5: WebGPU & Next-Gen | 🔮 Future | 0% | Low |

---

## ✅ Phase 1: Core Implementation (COMPLETE)

**Goal:** Implement full KTX2 progressive loading pipeline
**Status:** ✅ 100% Complete
**Timeline:** Completed

### Milestone 1.1: HTTP Range Requests + KTX2 Parsing ✅
**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

- ✅ `probe()` - Full KTX2 header parsing (80 bytes + level index)
- ✅ `fetchRange()` - HTTP Range requests with GET fallback
- ✅ Validation of 12-byte KTX2 identifier
- ✅ Level Index parsing (24 bytes per level, uint64 support)
- ✅ DFD (Data Format Descriptor) parsing
- ✅ KVD (Key-Value Data) extraction
- ✅ SGD (Supercompression Global Data) extraction
- ✅ HEAD request for Range support detection
- ✅ Color space detection (sRGB vs Linear)

### Milestone 1.2: Mini-KTX2 Repacking ✅
**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

- ✅ `repackSingleLevel()` - Create valid single-level KTX2 files
- ✅ Proper section alignment (DFD: 4-byte, SGD/data: 8-byte)
- ✅ Header updates (levelCount=1, dimensions)
- ✅ SGD repacking for ETC1S/BasisLZ format
- ✅ Metadata preservation (DFD, KVD, SGD)
- ✅ `imagesPerLevel()` calculation for ETC1S
- ✅ Minimal overhead (~100-200 bytes)

### Milestone 1.3: Transcoding Pipeline ✅
**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

- ✅ `transcode()` - Routing between worker and main thread
- ✅ `transcodeMainThread()` - libktx WASM integration
- ✅ `createKtxApi()` - cwrap wrappers for C API
- ✅ Safe WASM heap allocation/deallocation
- ✅ API: ktxTexture2_CreateFromMemory, TranscodeBasis, GetData
- ✅ RGBA extraction from WASM heap
- ✅ Heap usage tracking (before/after/freed)
- ✅ Error handling with proper cleanup

### Milestone 1.4: GPU Upload & Progressive Loading ✅
**Files:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

- ✅ `createTexture()` - PlayCanvas texture initialization
- ✅ `uploadMipLevel()` - WebGL2 texImage2D for mipmaps
- ✅ `applyTextureToEntity()` - Material integration
- ✅ `loadToEntity()` - Main progressive loading loop
- ✅ Custom shader chunks for LOD clamping
- ✅ WebGL TEXTURE_BASE_LEVEL / TEXTURE_MAX_LEVEL control
- ✅ Anisotropic filtering support
- ✅ sRGB vs Linear format handling
- ✅ Memory cleanup after each level

### Milestone 1.5: Adaptive Loading ✅
**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

- ✅ `calculateStartLevel()` - Screen-size based level selection
- ✅ AABB projection to screen space
- ✅ Camera integration (PlayCanvas Camera API)
- ✅ Adaptive margin configuration (default: 1.5x)
- ✅ Graceful fallback on missing camera/AABB

### Milestone 1.6: IndexedDB Caching ✅
**File:** `src/ktx2-loader/KtxCacheManager.ts`

- ✅ `saveMip()` - Save transcoded RGBA to IndexedDB
- ✅ `loadMip()` - Load from cache
- ✅ `getMipList()` - List cached levels
- ✅ `clearOld()` - TTL-based cache cleanup
- ✅ Cache keys: `${ktxUrl}#L${level}`
- ✅ Metadata: width, height, timestamp, version
- ✅ Cache hit/miss tracking

### Milestone 1.7: Utility Functions ✅
**Files:** `src/ktx2-loader/utils/`

**alignment.ts:**
- ✅ `alignValue()` - 4/8 byte alignment
- ✅ `readU64asNumber()` - uint64 from DataView
- ✅ `writeU64()` - uint64 to DataView

**colorspace.ts:**
- ✅ `parseDFDColorSpace()` - DFD parsing
- ✅ Transfer function detection
- ✅ Color primaries extraction
- ✅ Pixel format recommendations

---

## ✅ Phase 2: Production Deployment (COMPLETE)

**Goal:** Make loader production-ready for PlayCanvas
**Status:** ✅ 100% Complete
**Timeline:** Completed 2025-01-04

### Milestone 2.1: External URL Support ✅
**File:** `src/ktx2-loader/LibktxLoader.ts` (NEW)

- ✅ `LibktxLoader` singleton class created
- ✅ Support for external libktx URLs (GitHub, CDN, etc.)
- ✅ Fallback to PlayCanvas Asset Registry
- ✅ fetch + eval pattern (bypass import() 403 errors)
- ✅ import.meta and export statement removal
- ✅ WASM module initialization with custom URLs
- ✅ Verbose logging for debugging

**Rationale:** In PlayCanvas published builds, script-type assets get moved to `/js/esm-scripts/` which returns 403 Forbidden. External URLs solve this problem.

### Milestone 2.2: Script Attribute System ✅
**File:** `src/scripts/Ktx2LoaderScript.ts`

- ✅ Fixed ESM Script pattern using `(pcRuntime as any).Script`
- ✅ `/** @attribute */` JSDoc comments for attributes
- ✅ New attributes: `libktxMjsUrl`, `libktxWasmUrl`
- ✅ TypeScript declarations: `declare app`, `declare entity`
- ✅ All attributes visible in PlayCanvas Inspector
- ✅ No `pc.registerScript()` call (modern ESM pattern)
- ✅ No `static attributes` object (pure JSDoc approach)

### Milestone 2.3: Build System Optimization ✅
**Files:** `package.json`, `tsconfig.esm.json`

- ✅ Removed libktx files from build output
- ✅ Disabled source maps (`inlineSourceMap: false`)
- ✅ Removed `copy-libs` script dependency
- ✅ Clean 7-file deployment (no bundled libraries)
- ✅ ES2022 target for modern JavaScript
- ✅ Optimized file sizes

**Build Output:**
```
build/esm/
├── ktx2-loader/
│   ├── Ktx2ProgressiveLoader.mjs
│   ├── KtxCacheManager.mjs
│   ├── LibktxLoader.mjs          ← NEW
│   ├── types.mjs
│   └── utils/
│       ├── alignment.mjs
│       └── colorspace.mjs
└── scripts/
    └── Ktx2LoaderScript.mjs
```

### Milestone 2.4: Production Testing ✅

- ✅ Tested in PlayCanvas Editor (development)
- ✅ Tested in published builds (production)
- ✅ External URL loading verified (GitHub raw URLs)
- ✅ CORS headers correct (raw.githubusercontent.com)
- ✅ No 403 errors in published builds
- ✅ Texture loading end-to-end working
- ✅ All script attributes functional

**Verified URLs:**
- `https://raw.githubusercontent.com/SashaRX/ktx-host/refs/heads/main/libktx.mjs`
- `https://raw.githubusercontent.com/SashaRX/ktx-host/refs/heads/main/libktx.wasm`

### Milestone 2.5: Documentation Updates ✅

- ✅ README.md updated with external URL instructions
- ✅ IMPLEMENTATION_SUMMARY.md reflects current state
- ✅ Code comments updated
- ✅ Configuration examples updated

---

## ✅ Phase 3: Performance Optimization (COMPLETE)

**Goal:** Improve loading speed and reduce main thread blocking
**Status:** ✅ 100% Complete
**Priority:** High
**Timeline:** 2025-01-04 → 2025-01-05

### Milestone 3.1: Web Worker Transcoding ✅

**File:** `src/workers/ktx-transcode.worker.ts`

**Tasks:**
- ✅ Create dedicated Web Worker for transcoding
- ✅ Implement message passing protocol:
  - `init` - Load libktx module in worker
  - `transcode` - Process mini-KTX2 data
  - `response` - Return RGBA + stats
- ✅ Transfer ArrayBuffers (zero-copy)
- ✅ Fallback to main thread on worker failure
- ✅ Error handling and timeout protection
- [ ] Worker pool for parallel textures (optional)

**Benefits:**
- Non-blocking main thread
- Stable 60 FPS during loading
- Better UX on low-end devices
- Support for multiple textures in parallel

**Implementation Notes:**
- Worker initialization via inline Blob URL
- Build-time worker code generation (`scripts/build-worker-inline.mjs`)
- 10s timeout for init, 30s for transcode
- Graceful fallback to main thread

### Milestone 3.2: Enhanced FPS Throttling ✅

**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

**Tasks:**
- ✅ `requestAnimationFrame()` integration for frame-accurate timing
- ✅ Dynamic `stepDelayMs` adjustment based on actual FPS
- ✅ Pause/resume loading API for user interactions
- ✅ Adaptive throttling (slow down on low FPS, speed up on high)
- ✅ FPS history tracking (rolling 10-frame average)
- ✅ Cleanup method (cancel RAF, terminate worker)

**New API:**
```typescript
loader.pause();                    // Pause loading
loader.resume();                   // Resume loading
loader.isPausedState();            // Check if paused
loader.getCurrentFps();            // Get current FPS estimate
loader.getCurrentStepDelay();      // Get adaptive delay
loader.destroy();                  // Cleanup resources
```

**Configuration:**
```typescript
{
  adaptiveThrottling: true,   // Enable adaptive delays
  targetFps: 60,              // Target frame rate
  minStepDelayMs: 0,          // Min delay when FPS high
  maxStepDelayMs: 500,        // Max delay when FPS low
  stepDelayMs: 150,           // Initial/default delay
  minFrameInterval: 16,       // Frame budget (60fps)
}
```

**Adaptive Logic:**
- FPS < 54 (90% of target): Increase delay by 10ms
- FPS > 66 (110% of target): Decrease delay by 10ms
- Delay clamped to [minStepDelayMs, maxStepDelayMs]
- RAF-based timing for smooth frame pacing

### Milestone 3.3: Advanced Caching ✅

**File:** `src/ktx2-loader/KtxCacheManager.ts`

**Tasks:**
- ✅ IndexedDB implementation with object stores
- ✅ Cache size limits with LRU eviction
- ✅ Cache statistics API (hits, misses, hit rate, size)
- ✅ TTL-based expiration (clearOld)
- ✅ Partial cache support (getMipList, loadMip, saveMip)
- ✅ Timestamp-based indexing for LRU
- [ ] Checksum validation (SHA-256) - future enhancement
- [ ] Preload API - future enhancement

**Implementation:**
```typescript
class KtxCacheManager {
  async getCacheStats(): Promise<CacheStats>;  // ✅ Implemented
  setMaxSize(megabytes: number): void;         // ✅ Implemented
  async loadMip(url, level): Promise<CachedMip | null>; // ✅ Implemented
  async saveMip(url, level, data, metadata): Promise<void>; // ✅ Implemented
  async clearOld(maxAgeDays): Promise<void>;   // ✅ Implemented
  async clear(): Promise<void>;                // ✅ Implemented
  close(): void;                               // ✅ Implemented
}
```

**Public API in Ktx2ProgressiveLoader:**
```typescript
loader.getCacheStats();          // Get cache statistics
loader.clearCache();             // Clear entire cache
loader.setCacheMaxSize(100);     // Set max size (MB)
```

**CacheStats interface:**
```typescript
{
  totalSize: number;      // Total cache size in bytes
  itemCount: number;      // Number of cached items
  hits: number;           // Cache hits since init
  misses: number;         // Cache misses since init
  hitRate: number;        // Hit rate percentage
  oldestTimestamp: number;
  newestTimestamp: number;
}
```

### Milestone 3.4: Memory Pool & Full KTX2 Assembly ✅

**Files:** `src/ktx2-loader/MemoryPool.ts`, `src/ktx2-loader/KtxCacheManager.ts`, `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

**Tasks:**
- ✅ MemoryPool class for ArrayBuffer reuse
- ✅ Size buckets for efficient allocation (1KB → 64MB)
- ✅ LRU eviction when pool size limit exceeded
- ✅ Pool statistics (allocated, reused, peak usage)
- ✅ Full KTX2 assembly from loaded mip levels
- ✅ Cache support for assembled full KTX2 files
- ✅ Config options: `enableMemoryPool`, `memoryPoolMaxSize`, `assembleFullKtx`, `cacheFullKtx`

**Implementation:**
```typescript
class MemoryPool {
  acquire(size: number): ArrayBuffer;  // Get buffer from pool
  release(buffer: ArrayBuffer): void;  // Return buffer to pool
  getStats(): MemoryPoolStats;         // Get pool statistics
  clear(): void;                       // Clear all buffers
}

// Memory pool stats
{
  allocated: number;     // Total buffers allocated
  reused: number;        // Buffers reused from pool
  peakUsage: number;     // Peak memory usage in bytes
  currentUsage: number;  // Current memory usage
  poolSize: number;      // Total pool size in bytes
}
```

**Full KTX2 Assembly:**
```typescript
// After loading all mip levels:
async assembleFullKtx2(probe, levelPayloads): Promise<Uint8Array> {
  // 1. Calculate total size (header + DFD + KVD + SGD + all levels)
  // 2. Allocate buffer from memory pool
  // 3. Copy header, DFD, KVD, SGD
  // 4. Copy all mip level payloads
  // 5. Update Level Index with correct offsets
  // 6. Return complete KTX2 file
}

// Cache assembled file
cacheManager.saveFullKtx(url, fullKtx, metadata);

// Load full file on subsequent visits (fast path)
const fullKtx = await cacheManager.loadFullKtx(url);
```

**Benefits:**
- Reduced memory allocations (reuse buffers)
- Lower GC pressure
- Full KTX2 files cached for instant loading
- One cache entry instead of N mip entries
- Compatible with standard KTX2 tools


## 🔮 Phase 4: Advanced Features (FUTURE)

**Goal:** Add hardware compression and advanced graphics features
**Status:** 🔮 Not Started
**Priority:** Medium
**Estimated Timeline:** 4-8 weeks

### Milestone 4.1: Hardware Compressed Formats 🔮

**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

**Tasks:**
- [ ] GPU capabilities detection (getExtension)
- [ ] Format selection based on platform:
  - ETC1/ETC2 (Android, iOS)
  - ASTC (modern mobile)
  - BC7/DXT (Desktop)
  - PVRTC (legacy iOS)
- [ ] Direct compressed texture upload (bypass RGBA)
- [ ] Transcode to appropriate format per platform
- [ ] Fallback chain: hardware → RGBA → error

**Benefits:**
- 4-8x less GPU memory
- Faster loading (no RGBA conversion)
- Better mobile performance

**Challenges:**
- Platform detection complexity
- Format compatibility matrix
- Testing across devices

### Milestone 4.2: Streaming Decode 🔮

**File:** `src/ktx2-loader/Ktx2ProgressiveLoader.ts`

**Tasks:**
- [ ] Progressive decoding within a single level
- [ ] Chunk-based loading (e.g., 64KB chunks)
- [ ] Incremental texture updates
- [ ] Early preview (show partial level)
- [ ] Bandwidth-aware chunk sizing

**Use Case:** Very large textures (8K+) where even a single level is large

### Milestone 4.3: Multi-Texture Parallelization 🔮

**File:** `src/ktx2-loader/Ktx2TextureQueue.ts` (to be created)

**Tasks:**
- [ ] Texture loading queue with priorities
- [ ] Parallel loading (multiple textures simultaneously)
- [ ] Bandwidth allocation across textures
- [ ] Cancellation API (stop loading unused textures)
- [ ] Progress aggregation for multiple textures

**API:**
```typescript
const queue = new Ktx2TextureQueue({
  maxConcurrent: 3,
  bandwidthLimit: 5 * 1024 * 1024 // 5 MB/s
});

queue.add(url1, entity1, { priority: 'high' });
queue.add(url2, entity2, { priority: 'low' });
```

### Milestone 4.4: LOD Management 🔮

**File:** `src/ktx2-loader/Ktx2LodManager.ts` (to be created)

**Tasks:**
- [ ] Automatic LOD switching based on distance
- [ ] Unload high-res levels when entity is far
- [ ] Reload when entity gets close
- [ ] Memory-aware LOD budgets
- [ ] Camera frustum culling integration

---

## 🔮 Phase 5: WebGPU & Next-Gen (FUTURE)

**Goal:** Support next-generation graphics APIs
**Status:** 🔮 Not Started
**Priority:** Low
**Estimated Timeline:** 8+ weeks

### Milestone 5.1: WebGPU Backend 🔮

**File:** `src/ktx2-loader/backends/WebGPUBackend.ts` (to be created)

**Tasks:**
- [ ] Detect WebGPU availability
- [ ] Create `GPUTexture` instead of WebGL textures
- [ ] Use `queue.writeTexture()` for mipmap uploads
- [ ] Support WebGPU texture formats (BC6H, BC7, ASTC)
- [ ] Fallback to WebGL when WebGPU unavailable
- [ ] Unified API for both backends

**Benefits:**
- Better performance on modern browsers
- More texture formats
- Future-proof architecture

### Milestone 5.2: Vulkan/Metal Texture Formats 🔮

**Tasks:**
- [ ] Support for VK_FORMAT_* formats
- [ ] Metal texture format mapping
- [ ] Cross-platform format conversion

---

## 📈 Progress Tracking

### Current Milestone Status

| Milestone | Progress | Status |
|-----------|----------|--------|
| 1.1 - 1.7 (Phase 1) | 100% | ✅ Complete |
| 2.1 - 2.5 (Phase 2) | 100% | ✅ Complete |
| 3.1 - 3.4 (Phase 3) | 0% | ⏳ Planned |
| 4.1 - 4.4 (Phase 4) | 0% | 🔮 Future |
| 5.1 - 5.2 (Phase 5) | 0% | 🔮 Future |

### Recent Achievements (Last 7 Days)

✅ **Jan 4, 2025 (Phase 3):**
- Implemented Web Worker transcoding
- Added ktx-transcode.worker.ts
- Zero-copy ArrayBuffer transfer
- Worker initialization with timeout
- Fallback to main thread
- Build script for inline worker code

✅ **Jan 4, 2025 (Phase 2):**
- Created `LibktxLoader` singleton for external URL support
- Fixed ESM script attributes (Script class + JSDoc)
- Removed libktx from build output
- Disabled source maps
- Tested end-to-end in production
- Updated documentation

### Next Steps (Priority Order)

1. **Test Worker Implementation** (High Priority)
   - Enable useWorker in script
   - Verify 60 FPS maintained
   - Test fallback to main thread
   - Measure performance improvement

2. **Enhanced FPS Throttling** (Milestone 3.2)
   - RequestAnimationFrame integration
   - Dynamic stepDelayMs
   - Pause/resume API

3. **Advanced Caching** (Milestone 3.3)
   - Checksum validation
   - Partial cache support
   - Cache size limits

4. **Memory Monitoring** (Milestone 3.4)
   - Real-time heap tracking
   - Warning events
   - Automatic cleanup

---

## 🎯 Success Metrics

### Phase 1-2 (Complete) ✅

- ✅ Load 2048x2048 KTX2 texture progressively
- ✅ Support HTTP Range requests
- ✅ IndexedDB caching working
- ✅ PlayCanvas Editor integration
- ✅ Production deployment successful
- ✅ Zero 403 errors in published builds

### Phase 3 Targets (Planned)

- [ ] 60 FPS maintained during loading (Web Worker)
- [ ] <100ms overhead per level (Worker message passing)
- [ ] Cache hit rate >80% on revisits
- [ ] <50MB total memory for 4K texture

### Phase 4 Targets (Future)

- [ ] 4x memory reduction (hardware formats)
- [ ] Support 90% of mobile/desktop GPUs
- [ ] <1s load time for 2K texture on 4G network

---

## 📚 References

### Documentation
- [README.md](./README.md) - Project overview
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Technical details
- [BUILD_LIBKTX_GUIDE.md](./BUILD_LIBKTX_GUIDE.md) - Building libktx from source

### External Resources
- [KTX2 Specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [PlayCanvas Engine Docs](https://developer.playcanvas.com/)
- [Basis Universal](https://github.com/BinomialLLC/basis_universal)
- [KTX-Software](https://github.com/KhronosGroup/KTX-Software)

---

## 🏆 Summary

**Current Status:** 🎉 **Production Ready**

The KTX2 Progressive Loader is fully functional and deployed to production with:
- ✅ Complete progressive loading pipeline
- ✅ External URL support (no 403 errors)
- ✅ IndexedDB caching
- ✅ PlayCanvas integration (ESM scripts)
- ✅ Comprehensive documentation

**Next Focus:** Performance optimization through Web Worker implementation (Phase 3)

**Long-term Vision:** Hardware compressed formats + WebGPU support for next-gen performance

---

**Maintained by:** Claude AI
**Project Owner:** SashaRX
**Repository:** https://github.com/SashaRX/ktx2-progressive-loader-esm

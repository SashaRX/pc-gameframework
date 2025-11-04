/**
 * Type definitions for KTX2 Progressive Loader
 */

import type * as pc from 'playcanvas';

// ============================================================================
// Configuration Interfaces
// ============================================================================

export interface Ktx2LoaderConfig {
  /** URL to the KTX2 file */
  ktxUrl: string;

  /** External URL for libktx.mjs (optional, overrides Asset Registry) */
  libktxModuleUrl?: string;

  /** External URL for libktx.wasm (optional, overrides Asset Registry) */
  libktxWasmUrl?: string;

  /** Enable progressive loading (load mips sequentially) */
  progressive?: boolean;
  
  /** Treat texture as sRGB (for albedo/diffuse maps) */
  isSrgb?: boolean;
  
  /** Delay between loading steps (ms) */
  stepDelayMs?: number;
  
  /** Enable verbose logging (deprecated - use logLevel instead) */
  verbose?: boolean;

  /** Log verbosity level: 0=silent, 1=errors, 2=important, 3=detailed */
  logLevel?: number;
  
  /** Maximum RGBA bytes allowed in memory */
  maxRgbaBytes?: number;
  
  /** Enable anisotropic filtering if available */
  enableAniso?: boolean;
  
  /** Adaptive loading: stop at screen resolution */
  adaptiveLoading?: boolean;
  
  /** Adaptive margin multiplier */
  adaptiveMargin?: number;

  /** Adaptive update interval in seconds (check if more detail needed) */
  adaptiveUpdateInterval?: number;

  /** Use Web Worker for transcoding */
  useWorker?: boolean;
  
  /** Minimum frame interval (ms) to maintain FPS */
  minFrameInterval?: number;

  /** Enable IndexedDB cache */
  enableCache?: boolean;

  /** Cache TTL in days */
  cacheMaxAgeDays?: number;

  /** Enable adaptive FPS throttling (adjust delays based on actual FPS) */
  adaptiveThrottling?: boolean;

  /** Target FPS for adaptive throttling */
  targetFps?: number;

  /** Maximum stepDelayMs when FPS is low */
  maxStepDelayMs?: number;

  /** Minimum stepDelayMs when FPS is high */
  minStepDelayMs?: number;

  /** Enable memory pool for buffer reuse */
  enableMemoryPool?: boolean;

  /** Maximum memory pool size in bytes */
  memoryPoolMaxSize?: number;

  /** Assemble full KTX2 file after loading all mips */
  assembleFullKtx?: boolean;

  /** Cache full KTX2 file (requires assembleFullKtx) */
  cacheFullKtx?: boolean;
}

// ============================================================================
// Probe Result
// ============================================================================

export interface Ktx2ProbeResult {
  url: string;
  totalSize: number;
  supportsRanges: boolean;
  headerSize: number;
  headerBytes: Uint8Array;
  levelCount: number;
  layerCount: number;
  faceCount: number;
  pixelDepth: number;
  levelIndexSize: number;
  levels: Ktx2LevelInfo[];
  dfd: Uint8Array;
  kvd: Uint8Array;
  sgd: Uint8Array;
  dfdOff: number;
  dfdLen: number;
  kvdOff: number;
  kvdLen: number;
  sgdOff: number;
  sgdLen: number;
  width: number;
  height: number;
  colorSpace: Ktx2ColorSpace;
}

export interface Ktx2LevelInfo {
  byteOffset: number;
  byteLength: number;
  uncompressedByteLength: number;
}

export interface Ktx2ColorSpace {
  isSrgb: boolean;
  isLinear?: boolean;
  transferFunction: string;
  transferFunctionCode: number;
  primaries: string;
  primariesCode: number;
  colorModel: number;
  flags: number;
  recommendedPixelFormat: string;
}

// ============================================================================
// Transcode Result
// ============================================================================

export interface Ktx2TranscodeResult {
  width: number;
  height: number;
  data: Uint8Array;
  heapStats?: {
    before: number;
    after: number;
    freed: number;
  };
}

// ============================================================================
// Worker Messages
// ============================================================================

export interface WorkerInitMessage {
  type: 'init';
  data: {
    libktxCode: string;
    wasmUrl: string;
  };
}

export interface WorkerTranscodeMessage {
  type: 'transcode';
  messageId: number;
  data: {
    miniKtx: ArrayBuffer;
  };
}

export interface WorkerResponse {
  type: 'init' | 'transcode';
  success: boolean;
  messageId?: number;
  error?: string;
  stack?: string;
  width?: number;
  height?: number;
  data?: Uint8Array;
  heapStats?: {
    before: number;
    after: number;
    freed: number;
  };
}

// ============================================================================
// Progress Callbacks
// ============================================================================

export interface MipLoadInfo {
  level: number;
  width: number;
  height: number;
  byteLength: number;
  cached: boolean;
  transcodeTime: number;
}

export type OnProgressCallback = (
  level: number,
  totalLevels: number,
  mipInfo: MipLoadInfo
) => void;

export interface LoadStats {
  startTime: number;
  endTime?: number;
  bytesDownloaded: number;
  bytesTranscoded: number;
  levelsLoaded: number;
  levelsCached: number;
  heapPeakSize: number;
  heapCurrentSize: number;
  memoryFreed: number;
  totalTime?: number;
  averageTimePerLevel?: number;
}

export type OnCompleteCallback = (stats: LoadStats) => void;

// ============================================================================
// Cache Manager
// ============================================================================

export interface CachedMip {
  id: string;
  url: string;
  level: number;
  width: number;
  height: number;
  data: Uint8Array;
  timestamp: number;
  version: string;
  fileSize?: number;
  checksum?: string;
}

// ============================================================================
// KTX API (from libktx.mjs - cwrap C API)
// ============================================================================

/**
 * cwrap function wrappers for KTX C API
 * These are created using Module.cwrap() during initialization
 */
export interface KtxApi {
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  createFromMemory: (dataPtr: number, dataSize: number, createFlags: number, outTexPtrPtr: number) => number;
  destroy: (texPtr: number) => void;
  transcode: (texPtr: number, format: number, flags: number) => number;
  needsTranscoding: (texPtr: number) => number;
  getData: (texPtr: number) => number;
  getDataSize: (texPtr: number) => number;
  getWidth: (texPtr: number) => number;
  getHeight: (texPtr: number) => number;
  getLevels: (texPtr: number) => number;
  getOffset: (texPtr: number, level: number, layer: number, face: number) => number;
  errorString: (errorCode: number) => string;
}

/**
 * Emscripten Module interface with cwrap support
 */
export interface KtxModule {
  // cwrap utilities
  cwrap: (
    funcName: string,
    returnType: string | null,
    argTypes: string[]
  ) => (...args: any[]) => any;

  ccall: (
    funcName: string,
    returnType: string | null,
    argTypes: string[],
    args: any[]
  ) => any;

  getValue: (ptr: number, type: string) => number;
  setValue: (ptr: number, value: number, type: string) => void;

  // Enums (from embind)
  ErrorCode: {
    SUCCESS: { value: number };
    FILE_DATA_ERROR: { value: number };
    FILE_ISPIPE: { value: number };
    FILE_OPEN_FAILED: { value: number };
    FILE_OVERFLOW: { value: number };
    FILE_READ_ERROR: { value: number };
    FILE_SEEK_ERROR: { value: number };
    FILE_UNEXPECTED_EOF: { value: number };
    FILE_WRITE_ERROR: { value: number };
    GL_ERROR: { value: number };
    INVALID_OPERATION: { value: number };
    INVALID_VALUE: { value: number };
    NOT_FOUND: { value: number };
    OUT_OF_MEMORY: { value: number };
    TRANSCODE_FAILED: { value: number };
    UNKNOWN_FILE_FORMAT: { value: number };
    UNSUPPORTED_TEXTURE_TYPE: { value: number };
    UNSUPPORTED_FEATURE: { value: number };
  };

  TranscodeTarget: {
    ETC1_RGB: { value: number };
    ETC2_RGBA: { value: number };
    BC1_RGB: { value: number };
    BC3_RGBA: { value: number };
    BC4_R: { value: number };
    BC5_RG: { value: number };
    BC7_RGBA: { value: number };
    PVRTC1_4_RGB: { value: number };
    PVRTC1_4_RGBA: { value: number };
    ASTC_4x4_RGBA: { value: number };
    PVRTC2_4_RGB: { value: number };
    PVRTC2_4_RGBA: { value: number };
    ETC2_EAC_R11: { value: number };
    ETC2_EAC_RG11: { value: number };
    RGBA32: { value: number };
    RGB565: { value: number };
    BGR565: { value: number };
    RGBA4444: { value: number };
  };

  TranscodeFlags: {
    NONE: { value: number };
    HIGH_QUALITY: { value: number };
  };

  // Memory heap
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAP8: Int8Array;
  HEAP16: Int16Array;
  HEAP32: Int32Array;

  // Low-level memory functions
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;

  // Legacy embind exports (for backward compatibility)
  ktxTexture?: any;

  // Direct C function exports
  _ktxTexture2_CreateFromMemory?: (dataPtr: number, dataSize: number, createFlags: number, outTexPtrPtr: number) => number;
  _ktxTexture2_Destroy?: (texPtr: number) => void;
  _ktxTexture2_TranscodeBasis?: (texPtr: number, format: number, flags: number) => number;
  _ktxTexture2_NeedsTranscoding?: (texPtr: number) => number;
  _ktx_get_data?: (texPtr: number) => number;
  _ktx_get_data_size?: (texPtr: number) => number;
  _ktx_get_base_width?: (texPtr: number) => number;
  _ktx_get_base_height?: (texPtr: number) => number;
  _ktx_get_num_levels?: (texPtr: number) => number;
  _ktx_get_image_offset?: (texPtr: number, level: number, layer: number, face: number) => number;
  _ktxErrorString?: (errorCode: number) => number;
}

// ============================================================================
// Constants
// ============================================================================

export enum KtxTranscodeFormat {
  ETC1_RGB = 0,
  ETC2_RGBA = 1,
  BC1_RGB = 2,
  BC3_RGBA = 3,
  BC4_R = 4,
  BC5_RG = 5,
  BC7_RGBA = 6,
  PVRTC1_4_RGB = 8,
  PVRTC1_4_RGBA = 9,
  ASTC_4x4_RGBA = 10,
  PVRTC2_4_RGB = 18,
  PVRTC2_4_RGBA = 19,
  ETC2_EAC_R11 = 20,
  ETC2_EAC_RG11 = 21,
  RGBA32 = 13, // Uncompressed RGBA
  RGB565 = 14,
  BGR565 = 15,
  RGBA4444 = 16,
}

export enum KtxSupercompressionScheme {
  NONE = 0,
  BASIS_LZ = 1,
  ZSTD = 2,
  ZLIB = 3,
}

// ============================================================================
// Utility Types
// ============================================================================

export type Align = 4 | 8;

export interface AlignmentConfig {
  header: number;
  levelIndex: number;
  dfd: Align;
  kvd: Align;
  sgd: Align;
  data: Align;
}
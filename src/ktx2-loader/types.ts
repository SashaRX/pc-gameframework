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
  
  /** Enable progressive loading (load mips sequentially) */
  progressive?: boolean;
  
  /** Treat texture as sRGB (for albedo/diffuse maps) */
  isSrgb?: boolean;
  
  /** Delay between loading steps (ms) */
  stepDelayMs?: number;
  
  /** Enable verbose logging */
  verbose?: boolean;
  
  /** Maximum RGBA bytes allowed in memory */
  maxRgbaBytes?: number;
  
  /** Enable anisotropic filtering if available */
  enableAniso?: boolean;
  
  /** Adaptive loading: stop at screen resolution */
  adaptiveLoading?: boolean;
  
  /** Adaptive margin multiplier */
  adaptiveMargin?: number;
  
  /** Use Web Worker for transcoding */
  useWorker?: boolean;
  
  /** Minimum frame interval (ms) to maintain FPS */
  minFrameInterval?: number;
  
  /** Enable IndexedDB cache */
  enableCache?: boolean;
  
  /** Cache TTL in days */
  cacheMaxAgeDays?: number;
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
// KTX API (from libktx.mjs)
// ============================================================================

export interface KtxModule {
  cwrap: (name: string, returnType: string | null, argTypes: string[]) => (...args: any[]) => any;
  getValue: (ptr: number, type: string) => number;
  HEAPU8: Uint8Array;
}

export interface KtxApi {
  malloc: (size: number) => number;
  free: (ptr: number) => void;
  createFromMemory: (data: number, size: number, flags: number, outPtr: number) => number;
  destroy: (texPtr: number) => void;
  transcode: (texPtr: number, format: number, flags: number) => number;
  needsTranscoding: (texPtr: number) => number;
  getData: (texPtr: number) => number;
  getDataSize: (texPtr: number) => number;
  getWidth: (texPtr: number) => number;
  getHeight: (texPtr: number) => number;
  errorString: (code: number) => string;
  HEAPU8: Uint8Array;
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
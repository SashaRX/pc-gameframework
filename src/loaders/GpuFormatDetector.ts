/**
 * GPU Format Detector
 * Detects supported compressed texture formats for the current platform.
 * Supports both WebGL2 and WebGPU devices.
 */

export interface GpuCapabilities {
  // Desktop formats
  s3tc: boolean;        // BC1-BC3 (DXT1-DXT5) - Windows/Desktop
  s3tc_srgb: boolean;   // BC1-BC3 sRGB variant
  bptc: boolean;        // BC6H/BC7 - Modern Desktop
  rgtc: boolean;        // BC4/BC5 - Desktop

  // Mobile formats
  etc1: boolean;        // ETC1 - Legacy Android
  etc: boolean;         // ETC2/EAC - Modern Android/iOS
  astc: boolean;        // ASTC - Modern Mobile (best quality)
  pvrtc: boolean;       // PVRTC - Legacy iOS

  // Universal
  uncompressed: boolean; // Always true (RGBA fallback)
}

export enum TextureFormat {
  // BC (Desktop)
  BC1_RGB = 'BC1_RGB',           // DXT1
  BC1_RGBA = 'BC1_RGBA',         // DXT1 with 1-bit alpha
  BC3_RGBA = 'BC3_RGBA',         // DXT5
  BC4_R = 'BC4_R',               // RGTC1
  BC5_RG = 'BC5_RG',             // RGTC2
  BC6H_RGB_UF = 'BC6H_RGB_UF',   // HDR
  BC7_RGBA = 'BC7_RGBA',         // Best quality desktop

  // ETC (Mobile)
  ETC1_RGB = 'ETC1_RGB',         // Legacy Android
  ETC2_RGB = 'ETC2_RGB',         // Modern Android/iOS
  ETC2_RGBA = 'ETC2_RGBA',       // Modern Android/iOS with alpha
  ETC2_RGBA1 = 'ETC2_RGBA1',     // 1-bit alpha
  EAC_R11 = 'EAC_R11',           // Single channel
  EAC_RG11 = 'EAC_RG11',         // Two channel

  // ASTC (Modern Mobile)
  ASTC_4x4 = 'ASTC_4x4',         // Best quality
  ASTC_5x5 = 'ASTC_5x5',
  ASTC_6x6 = 'ASTC_6x6',
  ASTC_8x8 = 'ASTC_8x8',         // Good compression

  // PVRTC (Legacy iOS)
  PVRTC1_4_RGB = 'PVRTC1_4_RGB',
  PVRTC1_4_RGBA = 'PVRTC1_4_RGBA',
  PVRTC1_2_RGB = 'PVRTC1_2_RGB',
  PVRTC1_2_RGBA = 'PVRTC1_2_RGBA',

  // Fallback
  RGBA8 = 'RGBA8',               // Uncompressed
  SRGB8_ALPHA8 = 'SRGB8_ALPHA8', // Uncompressed sRGB
}

// Cached WebGL extension format constants
interface CachedExtFormats {
  // S3TC
  COMPRESSED_RGB_S3TC_DXT1_EXT?: number;
  COMPRESSED_RGBA_S3TC_DXT1_EXT?: number;
  COMPRESSED_RGBA_S3TC_DXT5_EXT?: number;
  // RGTC
  COMPRESSED_RED_RGTC1_EXT?: number;
  COMPRESSED_RED_GREEN_RGTC2_EXT?: number;
  // BPTC (BC7)
  COMPRESSED_RGBA_BPTC_UNORM_EXT?: number;
  // ETC1
  COMPRESSED_RGB_ETC1_WEBGL?: number;
  // ETC2
  COMPRESSED_RGB8_ETC2?: number;
  COMPRESSED_RGBA8_ETC2_EAC?: number;
  COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2?: number;
  // ASTC
  COMPRESSED_RGBA_ASTC_4x4_KHR?: number;
  COMPRESSED_RGBA_ASTC_6x6_KHR?: number;
  COMPRESSED_RGBA_ASTC_8x8_KHR?: number;
  // PVRTC
  COMPRESSED_RGB_PVRTC_4BPPV1_IMG?: number;
  COMPRESSED_RGBA_PVRTC_4BPPV1_IMG?: number;
  // WebGL base
  RGBA?: number;
  SRGB8_ALPHA8?: number;
}

export class GpuFormatDetector {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null;
  private isWebGpu: boolean;
  private capabilities: GpuCapabilities;
  /** Extension format constants cached at construction time */
  private extFormats: CachedExtFormats = {};

  /**
   * @param gl WebGL context, or null when running on a WebGPU device.
   */
  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext | null) {
    this.gl = gl;
    this.isWebGpu = (gl === null || gl === undefined);
    this.capabilities = this.isWebGpu
      ? this.detectWebGpuCapabilities()
      : this.detectWebGlCapabilities();

    if (!this.isWebGpu && gl) {
      this.cacheExtFormats(gl);
    }
  }

  // ============================================================================
  // Capability Detection
  // ============================================================================

  /**
   * Detect capabilities via WebGL extensions.
   */
  private detectWebGlCapabilities(): GpuCapabilities {
    const gl = this.gl!;
    return {
      s3tc: !!gl.getExtension('WEBGL_compressed_texture_s3tc') ||
            !!gl.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc') ||
            !!gl.getExtension('MOZ_WEBGL_compressed_texture_s3tc'),

      s3tc_srgb: !!gl.getExtension('WEBGL_compressed_texture_s3tc_srgb'),

      bptc: !!gl.getExtension('EXT_texture_compression_bptc'),

      rgtc: !!gl.getExtension('EXT_texture_compression_rgtc'),

      etc1: !!gl.getExtension('WEBGL_compressed_texture_etc1'),

      etc: !!gl.getExtension('WEBGL_compressed_texture_etc'),

      astc: !!gl.getExtension('WEBGL_compressed_texture_astc') ||
            !!gl.getExtension('WEBKIT_WEBGL_compressed_texture_astc'),

      pvrtc: !!gl.getExtension('WEBGL_compressed_texture_pvrtc') ||
             !!gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc'),

      uncompressed: true,
    };
  }

  /**
   * Conservative WebGPU capabilities.
   * WebGPU supports BC and ETC2/ASTC on modern hardware; PVRTC is unavailable.
   * We expose a safe set that matches Tier-2 desktop + modern mobile.
   */
  private detectWebGpuCapabilities(): GpuCapabilities {
    return {
      s3tc:       true,   // BC1-BC3 — universally supported on desktop
      s3tc_srgb:  true,
      bptc:       true,   // BC7 — supported on all WebGPU-capable desktop GPUs
      rgtc:       true,   // BC4/BC5
      etc1:       false,  // ETC1 not in WebGPU spec
      etc:        true,   // ETC2 — mandatory in WebGPU on mobile
      astc:       true,   // ASTC — mandatory on modern mobile
      pvrtc:      false,  // PVRTC not in WebGPU spec
      uncompressed: true,
    };
  }

  /**
   * Cache all extension format enum values at init time.
   * Avoids repeated getExtension() calls in hot paths.
   */
  private cacheExtFormats(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
    const s3tcSrgb = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb');
    const rgtc = gl.getExtension('EXT_texture_compression_rgtc');
    const bptc = gl.getExtension('EXT_texture_compression_bptc');
    const etc1 = gl.getExtension('WEBGL_compressed_texture_etc1');
    const etc  = gl.getExtension('WEBGL_compressed_texture_etc');
    const astc = gl.getExtension('WEBGL_compressed_texture_astc') ||
                 gl.getExtension('WEBKIT_WEBGL_compressed_texture_astc');
    const pvrtc = gl.getExtension('WEBGL_compressed_texture_pvrtc') ||
                  gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc');

    this.extFormats = {
      COMPRESSED_RGB_S3TC_DXT1_EXT:          (s3tc as any)?.COMPRESSED_RGB_S3TC_DXT1_EXT,
      COMPRESSED_RGBA_S3TC_DXT1_EXT:         (s3tc as any)?.COMPRESSED_RGBA_S3TC_DXT1_EXT,
      COMPRESSED_RGBA_S3TC_DXT5_EXT:         (s3tc as any)?.COMPRESSED_RGBA_S3TC_DXT5_EXT,
      COMPRESSED_RED_RGTC1_EXT:              (rgtc as any)?.COMPRESSED_RED_RGTC1_EXT,
      COMPRESSED_RED_GREEN_RGTC2_EXT:        (rgtc as any)?.COMPRESSED_RED_GREEN_RGTC2_EXT,
      COMPRESSED_RGBA_BPTC_UNORM_EXT:        (bptc as any)?.COMPRESSED_RGBA_BPTC_UNORM_EXT,
      COMPRESSED_RGB_ETC1_WEBGL:             (etc1 as any)?.COMPRESSED_RGB_ETC1_WEBGL,
      COMPRESSED_RGB8_ETC2:                  (etc as any)?.COMPRESSED_RGB8_ETC2,
      COMPRESSED_RGBA8_ETC2_EAC:             (etc as any)?.COMPRESSED_RGBA8_ETC2_EAC,
      COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2: (etc as any)?.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2,
      COMPRESSED_RGBA_ASTC_4x4_KHR:          (astc as any)?.COMPRESSED_RGBA_ASTC_4x4_KHR,
      COMPRESSED_RGBA_ASTC_6x6_KHR:          (astc as any)?.COMPRESSED_RGBA_ASTC_6x6_KHR,
      COMPRESSED_RGBA_ASTC_8x8_KHR:          (astc as any)?.COMPRESSED_RGBA_ASTC_8x8_KHR,
      COMPRESSED_RGB_PVRTC_4BPPV1_IMG:       (pvrtc as any)?.COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
      COMPRESSED_RGBA_PVRTC_4BPPV1_IMG:      (pvrtc as any)?.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG,
      RGBA:           gl.RGBA,
      SRGB8_ALPHA8:   (gl as WebGL2RenderingContext).SRGB8_ALPHA8 ?? gl.RGBA,
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  getCapabilities(): GpuCapabilities {
    return { ...this.capabilities };
  }

  isWebGpuDevice(): boolean {
    return this.isWebGpu;
  }

  isSupported(format: TextureFormat): boolean {
    switch (format) {
      case TextureFormat.BC1_RGB:
      case TextureFormat.BC1_RGBA:
      case TextureFormat.BC3_RGBA:    return this.capabilities.s3tc;
      case TextureFormat.BC4_R:
      case TextureFormat.BC5_RG:      return this.capabilities.rgtc;
      case TextureFormat.BC6H_RGB_UF:
      case TextureFormat.BC7_RGBA:    return this.capabilities.bptc;
      case TextureFormat.ETC1_RGB:    return this.capabilities.etc1;
      case TextureFormat.ETC2_RGB:
      case TextureFormat.ETC2_RGBA:
      case TextureFormat.ETC2_RGBA1:
      case TextureFormat.EAC_R11:
      case TextureFormat.EAC_RG11:    return this.capabilities.etc;
      case TextureFormat.ASTC_4x4:
      case TextureFormat.ASTC_5x5:
      case TextureFormat.ASTC_6x6:
      case TextureFormat.ASTC_8x8:    return this.capabilities.astc;
      case TextureFormat.PVRTC1_4_RGB:
      case TextureFormat.PVRTC1_4_RGBA:
      case TextureFormat.PVRTC1_2_RGB:
      case TextureFormat.PVRTC1_2_RGBA: return this.capabilities.pvrtc;
      case TextureFormat.RGBA8:
      case TextureFormat.SRGB8_ALPHA8:  return true;
      default: return false;
    }
  }

  getBestFormat(hasAlpha: boolean, isSrgb: boolean): TextureFormat {
    if (this.capabilities.astc) return TextureFormat.ASTC_4x4;
    if (this.capabilities.bptc) return TextureFormat.BC7_RGBA;
    if (this.capabilities.etc)  return hasAlpha ? TextureFormat.ETC2_RGBA : TextureFormat.ETC2_RGB;
    if (this.capabilities.s3tc) return hasAlpha ? TextureFormat.BC3_RGBA  : TextureFormat.BC1_RGB;
    if (this.capabilities.etc1 && !hasAlpha) return TextureFormat.ETC1_RGB;
    if (this.capabilities.pvrtc) return hasAlpha ? TextureFormat.PVRTC1_4_RGBA : TextureFormat.PVRTC1_4_RGB;
    return isSrgb ? TextureFormat.SRGB8_ALPHA8 : TextureFormat.RGBA8;
  }

  /**
   * Get WebGL internal format constant.
   * Uses cached values — no getExtension() calls.
   * On WebGPU returns 0 (not applicable; upload path uses PlayCanvas abstraction).
   */
  getInternalFormat(format: TextureFormat): number {
    if (this.isWebGpu) return 0;

    const f = this.extFormats;
    switch (format) {
      case TextureFormat.BC1_RGB:    return f.COMPRESSED_RGB_S3TC_DXT1_EXT   ?? 0;
      case TextureFormat.BC1_RGBA:   return f.COMPRESSED_RGBA_S3TC_DXT1_EXT  ?? 0;
      case TextureFormat.BC3_RGBA:   return f.COMPRESSED_RGBA_S3TC_DXT5_EXT  ?? 0;
      case TextureFormat.BC4_R:      return f.COMPRESSED_RED_RGTC1_EXT       ?? 0;
      case TextureFormat.BC5_RG:     return f.COMPRESSED_RED_GREEN_RGTC2_EXT ?? 0;
      case TextureFormat.BC7_RGBA:   return f.COMPRESSED_RGBA_BPTC_UNORM_EXT ?? 0;
      case TextureFormat.ETC1_RGB:   return f.COMPRESSED_RGB_ETC1_WEBGL      ?? 0;
      case TextureFormat.ETC2_RGB:   return f.COMPRESSED_RGB8_ETC2           ?? 0;
      case TextureFormat.ETC2_RGBA:  return f.COMPRESSED_RGBA8_ETC2_EAC      ?? 0;
      case TextureFormat.ETC2_RGBA1: return f.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 ?? 0;
      case TextureFormat.ASTC_4x4:   return f.COMPRESSED_RGBA_ASTC_4x4_KHR   ?? 0;
      case TextureFormat.ASTC_6x6:   return f.COMPRESSED_RGBA_ASTC_6x6_KHR   ?? 0;
      case TextureFormat.ASTC_8x8:   return f.COMPRESSED_RGBA_ASTC_8x8_KHR   ?? 0;
      case TextureFormat.PVRTC1_4_RGB:  return f.COMPRESSED_RGB_PVRTC_4BPPV1_IMG  ?? 0;
      case TextureFormat.PVRTC1_4_RGBA: return f.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG ?? 0;
      case TextureFormat.RGBA8:       return f.RGBA          ?? 0x1908; // gl.RGBA
      case TextureFormat.SRGB8_ALPHA8:return f.SRGB8_ALPHA8  ?? 0x8C43; // gl.SRGB8_ALPHA8
      default: return 0;
    }
  }

  logCapabilities(): void {
    const caps = this.capabilities;
    console.log(`[GPU] Device: ${this.isWebGpu ? 'WebGPU' : 'WebGL2'}`);
    console.log('[GPU] Compressed Texture Format Support:');
    console.log('  Desktop:');
    console.log('    - S3TC (BC1-BC3/DXT):', caps.s3tc    ? '✅' : '❌');
    console.log('    - S3TC sRGB:         ', caps.s3tc_srgb ? '✅' : '❌');
    console.log('    - BPTC (BC6H/BC7):   ', caps.bptc    ? '✅' : '❌');
    console.log('    - RGTC (BC4/BC5):    ', caps.rgtc    ? '✅' : '❌');
    console.log('  Mobile:');
    console.log('    - ETC1:              ', caps.etc1    ? '✅' : '❌');
    console.log('    - ETC2/EAC:          ', caps.etc     ? '✅' : '❌');
    console.log('    - ASTC:              ', caps.astc    ? '✅' : '❌');
    console.log('    - PVRTC:             ', caps.pvrtc   ? '✅' : '❌');
    const bestRGB  = this.getBestFormat(false, false);
    const bestRGBA = this.getBestFormat(true, false);
    console.log('[GPU] Best formats:');
    console.log('    - RGB: ', bestRGB);
    console.log('    - RGBA:', bestRGBA);
  }
}

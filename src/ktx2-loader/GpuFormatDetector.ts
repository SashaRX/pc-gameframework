/**
 * GPU Format Detector
 * Detects supported compressed texture formats for the current platform
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

export class GpuFormatDetector {
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  private capabilities: GpuCapabilities;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;
    this.capabilities = this.detectCapabilities();
  }

  /**
   * Detect all supported compressed texture formats
   */
  private detectCapabilities(): GpuCapabilities {
    const gl = this.gl;

    return {
      // Desktop formats
      s3tc: !!gl.getExtension('WEBGL_compressed_texture_s3tc') ||
            !!gl.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc') ||
            !!gl.getExtension('MOZ_WEBGL_compressed_texture_s3tc'),

      s3tc_srgb: !!gl.getExtension('WEBGL_compressed_texture_s3tc_srgb'),

      bptc: !!gl.getExtension('EXT_texture_compression_bptc'),

      rgtc: !!gl.getExtension('EXT_texture_compression_rgtc'),

      // Mobile formats
      etc1: !!gl.getExtension('WEBGL_compressed_texture_etc1'),

      etc: !!gl.getExtension('WEBGL_compressed_texture_etc'),

      astc: !!gl.getExtension('WEBGL_compressed_texture_astc') ||
            !!gl.getExtension('WEBKIT_WEBGL_compressed_texture_astc'),

      pvrtc: !!gl.getExtension('WEBGL_compressed_texture_pvrtc') ||
             !!gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc'),

      // Always supported
      uncompressed: true,
    };
  }

  /**
   * Get detected capabilities
   */
  getCapabilities(): GpuCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Check if specific format is supported
   */
  isSupported(format: TextureFormat): boolean {
    switch (format) {
      // BC formats
      case TextureFormat.BC1_RGB:
      case TextureFormat.BC1_RGBA:
      case TextureFormat.BC3_RGBA:
        return this.capabilities.s3tc;

      case TextureFormat.BC4_R:
      case TextureFormat.BC5_RG:
        return this.capabilities.rgtc;

      case TextureFormat.BC6H_RGB_UF:
      case TextureFormat.BC7_RGBA:
        return this.capabilities.bptc;

      // ETC formats
      case TextureFormat.ETC1_RGB:
        return this.capabilities.etc1;

      case TextureFormat.ETC2_RGB:
      case TextureFormat.ETC2_RGBA:
      case TextureFormat.ETC2_RGBA1:
      case TextureFormat.EAC_R11:
      case TextureFormat.EAC_RG11:
        return this.capabilities.etc;

      // ASTC formats
      case TextureFormat.ASTC_4x4:
      case TextureFormat.ASTC_5x5:
      case TextureFormat.ASTC_6x6:
      case TextureFormat.ASTC_8x8:
        return this.capabilities.astc;

      // PVRTC formats
      case TextureFormat.PVRTC1_4_RGB:
      case TextureFormat.PVRTC1_4_RGBA:
      case TextureFormat.PVRTC1_2_RGB:
      case TextureFormat.PVRTC1_2_RGBA:
        return this.capabilities.pvrtc;

      // Fallback
      case TextureFormat.RGBA8:
      case TextureFormat.SRGB8_ALPHA8:
        return true;

      default:
        return false;
    }
  }

  /**
   * Get best format for current platform
   * Priority: ASTC > BC7 > ETC2 > BC3 > ETC1 > PVRTC > RGBA
   */
  getBestFormat(hasAlpha: boolean, isSrgb: boolean): TextureFormat {
    // Modern mobile - ASTC (best quality/compression ratio)
    if (this.capabilities.astc) {
      return TextureFormat.ASTC_4x4; // 8bpp, best quality
    }

    // Modern desktop - BC7 (best quality)
    if (this.capabilities.bptc) {
      return TextureFormat.BC7_RGBA;
    }

    // Modern mobile/iOS - ETC2
    if (this.capabilities.etc) {
      return hasAlpha ? TextureFormat.ETC2_RGBA : TextureFormat.ETC2_RGB;
    }

    // Desktop - BC1/BC3 (DXT1/DXT5)
    if (this.capabilities.s3tc) {
      return hasAlpha ? TextureFormat.BC3_RGBA : TextureFormat.BC1_RGB;
    }

    // Legacy Android - ETC1 (no alpha support)
    if (this.capabilities.etc1 && !hasAlpha) {
      return TextureFormat.ETC1_RGB;
    }

    // Legacy iOS - PVRTC
    if (this.capabilities.pvrtc) {
      return hasAlpha ? TextureFormat.PVRTC1_4_RGBA : TextureFormat.PVRTC1_4_RGB;
    }

    // Fallback to uncompressed
    return isSrgb ? TextureFormat.SRGB8_ALPHA8 : TextureFormat.RGBA8;
  }

  /**
   * Get WebGL internal format constant for texture format
   */
  getInternalFormat(format: TextureFormat): number {
    const gl = this.gl;

    // Get extensions
    const s3tc = gl.getExtension('WEBGL_compressed_texture_s3tc');
    const etc = gl.getExtension('WEBGL_compressed_texture_etc');
    const astc = gl.getExtension('WEBGL_compressed_texture_astc') ||
                 gl.getExtension('WEBKIT_WEBGL_compressed_texture_astc');
    const pvrtc = gl.getExtension('WEBGL_compressed_texture_pvrtc') ||
                  gl.getExtension('WEBKIT_WEBGL_compressed_texture_pvrtc');
    const rgtc = gl.getExtension('EXT_texture_compression_rgtc');
    const bptc = gl.getExtension('EXT_texture_compression_bptc');

    switch (format) {
      // BC formats
      case TextureFormat.BC1_RGB:
        return s3tc?.COMPRESSED_RGB_S3TC_DXT1_EXT ?? 0;
      case TextureFormat.BC1_RGBA:
        return s3tc?.COMPRESSED_RGBA_S3TC_DXT1_EXT ?? 0;
      case TextureFormat.BC3_RGBA:
        return s3tc?.COMPRESSED_RGBA_S3TC_DXT5_EXT ?? 0;
      case TextureFormat.BC4_R:
        return rgtc?.COMPRESSED_RED_RGTC1_EXT ?? 0;
      case TextureFormat.BC5_RG:
        return rgtc?.COMPRESSED_RED_GREEN_RGTC2_EXT ?? 0;
      case TextureFormat.BC7_RGBA:
        return bptc?.COMPRESSED_RGBA_BPTC_UNORM_EXT ?? 0;

      // ETC formats
      case TextureFormat.ETC1_RGB:
        return (gl.getExtension('WEBGL_compressed_texture_etc1') as any)?.COMPRESSED_RGB_ETC1_WEBGL ?? 0;
      case TextureFormat.ETC2_RGB:
        return etc?.COMPRESSED_RGB8_ETC2 ?? 0;
      case TextureFormat.ETC2_RGBA:
        return etc?.COMPRESSED_RGBA8_ETC2_EAC ?? 0;
      case TextureFormat.ETC2_RGBA1:
        return etc?.COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2 ?? 0;

      // ASTC formats
      case TextureFormat.ASTC_4x4:
        return astc?.COMPRESSED_RGBA_ASTC_4x4_KHR ?? 0;
      case TextureFormat.ASTC_6x6:
        return astc?.COMPRESSED_RGBA_ASTC_6x6_KHR ?? 0;
      case TextureFormat.ASTC_8x8:
        return astc?.COMPRESSED_RGBA_ASTC_8x8_KHR ?? 0;

      // PVRTC formats
      case TextureFormat.PVRTC1_4_RGB:
        return pvrtc?.COMPRESSED_RGB_PVRTC_4BPPV1_IMG ?? 0;
      case TextureFormat.PVRTC1_4_RGBA:
        return pvrtc?.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG ?? 0;

      // Fallback
      case TextureFormat.RGBA8:
        return gl.RGBA;
      case TextureFormat.SRGB8_ALPHA8:
        return (gl as WebGL2RenderingContext).SRGB8_ALPHA8 ?? gl.RGBA;

      default:
        return 0;
    }
  }

  /**
   * Print capabilities to console
   */
  logCapabilities(): void {
    const caps = this.capabilities;
    console.log('[GPU] Compressed Texture Format Support:');
    console.log('  Desktop:');
    console.log('    - S3TC (BC1-BC3/DXT):', caps.s3tc ? '✅' : '❌');
    console.log('    - S3TC sRGB:        ', caps.s3tc_srgb ? '✅' : '❌');
    console.log('    - BPTC (BC6H/BC7):  ', caps.bptc ? '✅' : '❌');
    console.log('    - RGTC (BC4/BC5):   ', caps.rgtc ? '✅' : '❌');
    console.log('  Mobile:');
    console.log('    - ETC1:             ', caps.etc1 ? '✅' : '❌');
    console.log('    - ETC2/EAC:         ', caps.etc ? '✅' : '❌');
    console.log('    - ASTC:             ', caps.astc ? '✅' : '❌');
    console.log('    - PVRTC:            ', caps.pvrtc ? '✅' : '❌');

    const bestRGB = this.getBestFormat(false, false);
    const bestRGBA = this.getBestFormat(true, false);
    console.log('[GPU] Best formats:');
    console.log('    - RGB:  ', bestRGB);
    console.log('    - RGBA: ', bestRGBA);
  }
}

/**
 * Alignment utilities for KTX2 format
 */

/**
 * Align value to specified boundary
 * @param value Value to align
 * @param alignment Alignment boundary (4 or 8)
 */
export function alignValue(value: number, alignment: 4 | 8): number {
  return (value + (alignment - 1)) & ~(alignment - 1);
}

/**
 * Read uint64 value from DataView (little-endian)
 * JavaScript doesn't have native uint64, so we split into low/high 32-bit parts
 * 
 * @param view DataView to read from
 * @param offset Byte offset
 * @returns Number (may lose precision for values > 2^53)
 */
export function readU64asNumber(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return lo + hi * 4294967296;
}

/**
 * Write uint64 value to DataView (little-endian)
 * 
 * @param view DataView to write to
 * @param offset Byte offset
 * @param value Number to write (will be split into low/high 32-bit parts)
 */
export function writeU64(view: DataView, offset: number, value: number): void {
  const lo = value >>> 0;
  const hi = Math.floor(value / 4294967296) >>> 0;
  view.setUint32(offset, lo, true);
  view.setUint32(offset + 4, hi, true);
}

/**
 * KTX2 alignment requirements
 */
export const KTX2_ALIGNMENT = {
  HEADER: 1,
  LEVEL_INDEX: 1,
  DFD: 4,
  KVD: 4,
  SGD: 8,
  DATA: 8,
} as const;

/**
 * Validate that a buffer is properly aligned for a section
 */
export function validateAlignment(
  offset: number,
  section: keyof typeof KTX2_ALIGNMENT
): boolean {
  const required = KTX2_ALIGNMENT[section];
  return offset % required === 0;
}

/**
 * Calculate total size with alignment padding
 */
export function calculateAlignedSize(
  offset: number,
  dataSize: number,
  alignment: 4 | 8
): number {
  const alignedOffset = alignValue(offset, alignment);
  return alignedOffset + dataSize;
}
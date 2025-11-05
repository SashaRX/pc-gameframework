/**
 * Grid utilities for sector management
 */

import type * as pc from 'playcanvas';
import type { Vec2 } from '../types';

/**
 * Convert world position to grid coordinates
 *
 * @param worldPos - World position
 * @param gridSize - Size of each grid cell
 * @returns Grid coordinates
 */
export function worldToGrid(worldPos: pc.Vec3, gridSize: number): Vec2 {
  return {
    x: Math.floor(worldPos.x / gridSize) * gridSize,
    z: Math.floor(worldPos.z / gridSize) * gridSize,
  };
}

/**
 * Generate sector ID from grid coordinates
 *
 * @param gridCoords - Grid coordinates
 * @returns Sector ID string (e.g., "x50_z100")
 */
export function gridToSectorId(gridCoords: Vec2): string {
  const xStr = gridCoords.x >= 0 ? `x${gridCoords.x}` : `xn${Math.abs(gridCoords.x)}`;
  const zStr = gridCoords.z >= 0 ? `z${gridCoords.z}` : `zn${Math.abs(gridCoords.z)}`;
  return `${xStr}_${zStr}`;
}

/**
 * Parse sector ID to grid coordinates
 *
 * @param sectorId - Sector ID string (e.g., "x50_z100")
 * @returns Grid coordinates or null if invalid
 */
export function sectorIdToGrid(sectorId: string): Vec2 | null {
  const match = sectorId.match(/^x(n?)(\d+)_z(n?)(\d+)$/);
  if (!match) {
    return null;
  }

  const x = parseInt(match[2], 10) * (match[1] === 'n' ? -1 : 1);
  const z = parseInt(match[4], 10) * (match[3] === 'n' ? -1 : 1);

  return { x, z };
}

/**
 * Get center point of a grid cell
 *
 * @param gridCoords - Grid coordinates
 * @param gridSize - Size of each grid cell
 * @returns Center point in world space
 */
export function getGridCenter(gridCoords: Vec2, gridSize: number): Vec2 {
  return {
    x: gridCoords.x + gridSize / 2,
    z: gridCoords.z + gridSize / 2,
  };
}

/**
 * Get all grid cells within a radius
 *
 * @param centerPos - Center position (world space)
 * @param radius - Radius in world units
 * @param gridSize - Size of each grid cell
 * @returns Array of grid coordinates
 */
export function getGridCellsInRadius(
  centerPos: pc.Vec3,
  radius: number,
  gridSize: number
): Vec2[] {
  const center = worldToGrid(centerPos, gridSize);
  const cells: Vec2[] = [];

  // Calculate how many grid cells to check in each direction
  const cellRadius = Math.ceil(radius / gridSize);

  for (let dx = -cellRadius; dx <= cellRadius; dx++) {
    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      const gridX = center.x + dx * gridSize;
      const gridZ = center.z + dz * gridSize;

      // Check if cell center is within radius
      const cellCenter = getGridCenter({ x: gridX, z: gridZ }, gridSize);
      const distance = Math.sqrt(
        Math.pow(cellCenter.x - centerPos.x, 2) +
        Math.pow(cellCenter.z - centerPos.z, 2)
      );

      if (distance <= radius) {
        cells.push({ x: gridX, z: gridZ });
      }
    }
  }

  return cells;
}

/**
 * Get sector IDs within view distance
 *
 * @param cameraPos - Camera position
 * @param viewDistance - View distance
 * @param gridSize - Grid cell size
 * @returns Array of sector IDs
 */
export function getSectorIdsInRange(
  cameraPos: pc.Vec3,
  viewDistance: number,
  gridSize: number
): string[] {
  const cells = getGridCellsInRadius(cameraPos, viewDistance, gridSize);
  return cells.map(gridToSectorId);
}

/**
 * Calculate distance between two grid cells
 *
 * @param a - First grid coordinates
 * @param b - Second grid coordinates
 * @returns Distance in world units
 */
export function gridDistance(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Get neighboring sector IDs (8 directions + center)
 *
 * @param sectorId - Center sector ID
 * @param gridSize - Grid cell size
 * @param includeCenter - Include the center sector itself
 * @returns Array of neighboring sector IDs
 */
export function getNeighboringSectorIds(
  sectorId: string,
  gridSize: number,
  includeCenter: boolean = false
): string[] {
  const center = sectorIdToGrid(sectorId);
  if (!center) {
    return [];
  }

  const neighbors: string[] = [];
  const offsets = [
    { x: -1, z: -1 }, { x: 0, z: -1 }, { x: 1, z: -1 },
    { x: -1, z: 0 },  { x: 0, z: 0 },  { x: 1, z: 0 },
    { x: -1, z: 1 },  { x: 0, z: 1 },  { x: 1, z: 1 },
  ];

  for (const offset of offsets) {
    if (!includeCenter && offset.x === 0 && offset.z === 0) {
      continue;
    }

    const neighborCoords = {
      x: center.x + offset.x * gridSize,
      z: center.z + offset.z * gridSize,
    };

    neighbors.push(gridToSectorId(neighborCoords));
  }

  return neighbors;
}

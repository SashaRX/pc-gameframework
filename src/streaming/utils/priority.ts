/**
 * Priority calculation utilities for sector streaming
 */

import type * as pc from 'playcanvas';
import type { Vec2, PriorityInfo } from '../types';

/**
 * Calculate loading priority for a sector based on camera state
 *
 * @param sectorCoords - Sector center coordinates (world space)
 * @param cameraPos - Camera position (world space)
 * @param cameraDir - Camera forward direction (normalized)
 * @param viewDistance - Maximum view distance
 * @param velocity - Camera velocity (optional, for prediction)
 * @returns Priority info with detailed breakdown
 */
export function calculateSectorPriority(
  sectorCoords: Vec2,
  cameraPos: pc.Vec3,
  cameraDir: pc.Vec3,
  viewDistance: number,
  velocity?: pc.Vec3
): PriorityInfo {
  // Distance from camera to sector center (XZ plane)
  const dx = sectorCoords.x - cameraPos.x;
  const dz = sectorCoords.z - cameraPos.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  // Distance priority (0-1, where 1 = closest)
  // Use exponential falloff for more natural priority distribution
  const distancePriority = Math.max(0, 1.0 - Math.pow(distance / viewDistance, 2));

  // Direction to sector (normalized XZ plane)
  const toSectorX = dx / (distance + 0.001); // Avoid division by zero
  const toSectorZ = dz / (distance + 0.001);

  // Camera forward direction in XZ plane (normalized)
  const cameraDirXZ = Math.sqrt(cameraDir.x * cameraDir.x + cameraDir.z * cameraDir.z);
  const cameraForwardX = cameraDir.x / (cameraDirXZ + 0.001);
  const cameraForwardZ = cameraDir.z / (cameraDirXZ + 0.001);

  // Dot product: 1 = directly ahead, -1 = behind, 0 = perpendicular
  const dotProduct = toSectorX * cameraForwardX + toSectorZ * cameraForwardZ;

  // Direction priority (0-1, where 1 = directly ahead)
  // Map [-1, 1] to [0, 1] with emphasis on forward direction
  const directionPriority = Math.max(0, dotProduct * 0.5 + 0.5);

  // Velocity-based prediction (preload sectors we're moving towards)
  let velocityPriority = 0;
  if (velocity && velocity.lengthSq() > 0.01) {
    const velXZ = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
    const velDirX = velocity.x / (velXZ + 0.001);
    const velDirZ = velocity.z / (velXZ + 0.001);

    // Dot product with movement direction
    const velDot = toSectorX * velDirX + toSectorZ * velDirZ;
    velocityPriority = Math.max(0, velDot);
  }

  // Weighted combination of factors
  // Distance is most important, direction second, velocity for prediction
  const finalPriority =
    distancePriority * 0.5 +
    directionPriority * 0.3 +
    velocityPriority * 0.2;

  return {
    priority: finalPriority,
    distance,
    directionScore: directionPriority,
    velocityScore: velocityPriority,
  };
}

/**
 * Get sectors within view distance, sorted by priority
 *
 * @param allSectorCoords - All available sector coordinates
 * @param cameraPos - Camera position
 * @param cameraDir - Camera forward direction
 * @param viewDistance - Maximum view distance
 * @param velocity - Camera velocity (optional)
 * @returns Array of [sectorId, priority] sorted by priority (highest first)
 */
export function getSectorsByPriority(
  allSectorCoords: Map<string, Vec2>,
  cameraPos: pc.Vec3,
  cameraDir: pc.Vec3,
  viewDistance: number,
  velocity?: pc.Vec3
): Array<[string, PriorityInfo]> {
  const priorities: Array<[string, PriorityInfo]> = [];

  for (const [sectorId, coords] of allSectorCoords) {
    const priorityInfo = calculateSectorPriority(
      coords,
      cameraPos,
      cameraDir,
      viewDistance,
      velocity
    );

    // Only include sectors within view distance
    if (priorityInfo.distance <= viewDistance) {
      priorities.push([sectorId, priorityInfo]);
    }
  }

  // Sort by priority (highest first)
  priorities.sort((a, b) => b[1].priority - a[1].priority);

  return priorities;
}

/**
 * Calculate LOD level based on distance
 *
 * @param distance - Distance from camera
 * @param detailDistance - Distance for highest detail
 * @param viewDistance - Maximum view distance
 * @returns LOD level (0 = high, 1 = medium, 2 = low)
 */
export function calculateLodLevel(
  distance: number,
  detailDistance: number,
  viewDistance: number
): number {
  if (distance <= detailDistance) {
    return 0; // High detail
  } else if (distance <= viewDistance * 0.6) {
    return 1; // Medium detail
  } else {
    return 2; // Low detail
  }
}

/**
 * Check if a point is within camera frustum (simplified 2D check)
 *
 * @param point - Point to check (world space)
 * @param cameraPos - Camera position
 * @param cameraDir - Camera forward direction
 * @param fov - Field of view in degrees
 * @param viewDistance - Maximum view distance
 * @returns True if point is potentially visible
 */
export function isInFrustum(
  point: Vec2,
  cameraPos: pc.Vec3,
  cameraDir: pc.Vec3,
  fov: number,
  viewDistance: number
): boolean {
  // Distance check
  const dx = point.x - cameraPos.x;
  const dz = point.z - cameraPos.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance > viewDistance) {
    return false;
  }

  // Direction check (simplified frustum cone)
  const toPointX = dx / (distance + 0.001);
  const toPointZ = dz / (distance + 0.001);

  const cameraDirXZ = Math.sqrt(cameraDir.x * cameraDir.x + cameraDir.z * cameraDir.z);
  const cameraForwardX = cameraDir.x / (cameraDirXZ + 0.001);
  const cameraForwardZ = cameraDir.z / (cameraDirXZ + 0.001);

  const dotProduct = toPointX * cameraForwardX + toPointZ * cameraForwardZ;

  // Calculate frustum half-angle from FOV
  const halfFovRad = (fov / 2) * (Math.PI / 180);
  const minDot = Math.cos(halfFovRad);

  return dotProduct >= minDot;
}

/**
 * Memory manager for sector streaming
 * Implements LRU eviction when memory budget is exceeded
 */

import type { LoadedSector, MemoryStats } from './types';

export class MemoryManager {
  private budgetMB: number;
  private usage: Map<string, number> = new Map(); // sectorId -> memory in bytes
  private sectors: Map<string, LoadedSector> = new Map();

  constructor(budgetMB: number) {
    this.budgetMB = budgetMB;
  }

  /**
   * Register a sector's memory usage
   */
  registerSector(sectorId: string, sector: LoadedSector, memoryBytes: number): void {
    this.usage.set(sectorId, memoryBytes);
    this.sectors.set(sectorId, sector);
  }

  /**
   * Unregister a sector
   */
  unregisterSector(sectorId: string): void {
    this.usage.delete(sectorId);
    this.sectors.delete(sectorId);
  }

  /**
   * Check if we can allocate the requested memory
   */
  canAllocate(sizeMB: number): boolean {
    const currentUsageMB = this.getCurrentUsageMB();
    return currentUsageMB + sizeMB <= this.budgetMB;
  }

  /**
   * Attempt to allocate memory, freeing sectors if needed
   * Returns list of sector IDs that should be unloaded
   */
  allocate(sizeMB: number, currentSectorId?: string): string[] {
    const sizeBytes = sizeMB * 1024 * 1024;

    // Check if we need to free memory
    if (this.canAllocate(sizeMB)) {
      return [];
    }

    // Calculate how much we need to free
    const currentUsageBytes = this.getCurrentUsageBytes();
    const budgetBytes = this.budgetMB * 1024 * 1024;
    const needed = currentUsageBytes + sizeBytes - budgetBytes;

    return this.freeMemory(needed, currentSectorId);
  }

  /**
   * Free memory using LRU eviction
   * Returns list of sector IDs that should be unloaded
   */
  private freeMemory(neededBytes: number, protectedSectorId?: string): string[] {
    const toUnload: string[] = [];
    let freed = 0;

    // Sort sectors by priority (lowest first) and last access time (oldest first)
    const sorted = Array.from(this.sectors.entries())
      .filter(([id]) => id !== protectedSectorId) // Don't unload the current sector
      .sort((a, b) => {
        const [idA, sectorA] = a;
        const [idB, sectorB] = b;

        // First sort by priority (lower priority unloaded first)
        if (sectorA.priority !== sectorB.priority) {
          return sectorA.priority - sectorB.priority;
        }

        // Then by last access time (older first)
        return sectorA.lastAccessed - sectorB.lastAccessed;
      });

    // Unload sectors until we free enough memory
    for (const [sectorId, sector] of sorted) {
      const sectorMemory = this.usage.get(sectorId) || 0;
      toUnload.push(sectorId);
      freed += sectorMemory;

      if (freed >= neededBytes) {
        break;
      }
    }

    return toUnload;
  }

  /**
   * Update sector's last access time (for LRU)
   */
  touch(sectorId: string): void {
    const sector = this.sectors.get(sectorId);
    if (sector) {
      sector.lastAccessed = Date.now();
    }
  }

  /**
   * Update sector's priority
   */
  updatePriority(sectorId: string, priority: number): void {
    const sector = this.sectors.get(sectorId);
    if (sector) {
      sector.priority = priority;
    }
  }

  /**
   * Get current memory usage in MB
   */
  getCurrentUsageMB(): number {
    return this.getCurrentUsageBytes() / (1024 * 1024);
  }

  /**
   * Get current memory usage in bytes
   */
  getCurrentUsageBytes(): number {
    let total = 0;
    for (const size of this.usage.values()) {
      total += size;
    }
    return total;
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    return {
      totalUsedMB: this.getCurrentUsageMB(),
      budgetMB: this.budgetMB,
      sectorsLoaded: this.usage.size,
      sectorBreakdown: new Map(
        Array.from(this.usage.entries()).map(([id, bytes]) => [id, bytes / (1024 * 1024)])
      ),
    };
  }

  /**
   * Set memory budget
   */
  setBudget(budgetMB: number): void {
    this.budgetMB = budgetMB;
  }

  /**
   * Get sectors that should be unloaded to meet budget
   */
  getSectorsToUnload(): string[] {
    const currentUsageMB = this.getCurrentUsageMB();
    if (currentUsageMB <= this.budgetMB) {
      return [];
    }

    const excessBytes = (currentUsageMB - this.budgetMB) * 1024 * 1024;
    return this.freeMemory(excessBytes);
  }

  /**
   * Check if memory budget is exceeded
   */
  isOverBudget(): boolean {
    return this.getCurrentUsageMB() > this.budgetMB;
  }

  /**
   * Get memory usage for a specific sector
   */
  getSectorMemory(sectorId: string): number {
    return (this.usage.get(sectorId) || 0) / (1024 * 1024);
  }

  /**
   * Clear all tracked memory
   */
  clear(): void {
    this.usage.clear();
    this.sectors.clear();
  }
}

/**
 * SimpleScheduler - Manages texture loading queue with priority
 *
 * Features:
 * - Priority-based loading queue
 * - Concurrent load limit (e.g., 4 parallel loads)
 * - Cancellable jobs
 * - Load statistics
 */

import { PriorityQueue } from './PriorityQueue';
import type { TextureHandle } from './TextureHandle';
import type { MemoryTracker } from './MemoryTracker';

interface LoadJob {
  handle: TextureHandle;
  promise?: Promise<void>;
  startTime?: number;
}

export class SimpleScheduler {
  private queue: PriorityQueue<string>; // texture ID → priority
  private jobs: Map<string, LoadJob> = new Map(); // texture ID → job
  private activeLoads: Set<string> = new Set(); // currently loading IDs

  private maxConcurrent: number;
  private memoryTracker: MemoryTracker;

  // Statistics
  private totalLoaded: number = 0;
  private totalFailed: number = 0;
  private totalLoadTime: number = 0;

  // Handlers registry
  private handles: Map<string, TextureHandle> = new Map();

  constructor(maxConcurrent: number, memoryTracker: MemoryTracker) {
    this.queue = new PriorityQueue<string>();
    this.maxConcurrent = maxConcurrent;
    this.memoryTracker = memoryTracker;
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, max);
    // Try to start more jobs if we increased the limit
    this.processQueue();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  // =========================================================================
  // Queue Management
  // =========================================================================

  /**
   * Add texture to loading queue
   */
  enqueue(handle: TextureHandle, priority: number): void {
    const id = handle.id;

    // Skip if already loading or loaded
    if (this.activeLoads.has(id) || handle.isLoaded) {
      return;
    }

    // Store handle reference
    this.handles.set(id, handle);

    // Add to queue or update priority
    if (this.queue.contains(id)) {
      this.queue.updatePriority(id, -priority); // Min-heap, so negate for max-priority
    } else {
      this.queue.insert(id, -priority);
      this.jobs.set(id, { handle });
    }

    // Try to start loading
    this.processQueue();
  }

  /**
   * Remove texture from queue
   */
  dequeue(id: string): boolean {
    // If actively loading, cancel it
    if (this.activeLoads.has(id)) {
      this.cancel(id);
      return true;
    }

    // Remove from queue
    const removed = this.queue.remove(id);
    if (removed) {
      this.jobs.delete(id);
      this.handles.delete(id);
    }

    return removed;
  }

  /**
   * Update priority of queued texture
   */
  updatePriority(id: string, newPriority: number): void {
    if (this.queue.contains(id)) {
      this.queue.updatePriority(id, -newPriority); // Negate for min-heap
    }
  }

  /**
   * Cancel active load
   */
  cancel(id: string): void {
    const handle = this.handles.get(id);
    if (handle) {
      handle.cancel();
    }

    this.activeLoads.delete(id);
    this.jobs.delete(id);
    this.handles.delete(id);
  }

  /**
   * Clear all queued and active loads
   */
  clear(): void {
    // Cancel all active loads
    for (const id of this.activeLoads) {
      this.cancel(id);
    }

    // Clear queue
    this.queue.clear();
    this.jobs.clear();
    this.handles.clear();
    this.activeLoads.clear();
  }

  // =========================================================================
  // Processing
  // =========================================================================

  /**
   * Process queue and start loads up to maxConcurrent
   */
  private async processQueue(): Promise<void> {
    // Start as many jobs as we can
    while (
      this.activeLoads.size < this.maxConcurrent &&
      !this.queue.isEmpty()
    ) {
      const id = this.queue.extractMin();
      if (!id) break;

      const job = this.jobs.get(id);
      if (!job) continue;

      // Start loading
      this.startLoad(id, job);
    }
  }

  /**
   * Start loading a texture
   */
  private async startLoad(id: string, job: LoadJob): Promise<void> {
    const handle = job.handle;

    // Check memory budget
    const estimatedSize = 10 * 1024 * 1024; // Estimate 10MB per texture
    const canLoad = await this.memoryTracker.enforceBeforeLoad(estimatedSize);

    if (!canLoad) {
      console.warn(`[Scheduler] Not enough memory to load "${id}", requeueing...`);
      // Requeue with lower priority
      this.enqueue(handle, handle.priority * 0.5);
      return;
    }

    // Mark as active
    this.activeLoads.add(id);
    job.startTime = Date.now();

    // Start async load
    job.promise = handle
      .load()
      .then(() => {
        // Success
        const loadTime = Date.now() - job.startTime!;
        this.totalLoaded++;
        this.totalLoadTime += loadTime;

        console.log(
          `[Scheduler] Loaded "${id}" in ${loadTime.toFixed(0)}ms ` +
          `(${this.activeLoads.size}/${this.maxConcurrent} active)`
        );
      })
      .catch(err => {
        // Error
        this.totalFailed++;
        console.error(`[Scheduler] Failed to load "${id}":`, err);
      })
      .finally(() => {
        // Cleanup
        this.activeLoads.delete(id);
        this.jobs.delete(id);
        this.handles.delete(id);

        // Process next in queue
        this.processQueue();
      });
  }

  // =========================================================================
  // Status
  // =========================================================================

  getQueueSize(): number {
    return this.queue.size;
  }

  getActiveLoadCount(): number {
    return this.activeLoads.size;
  }

  isLoading(id: string): boolean {
    return this.activeLoads.has(id);
  }

  isQueued(id: string): boolean {
    return this.queue.contains(id);
  }

  // =========================================================================
  // Statistics
  // =========================================================================

  getStats() {
    return {
      queueSize: this.queue.size,
      activeLoads: this.activeLoads.size,
      maxConcurrent: this.maxConcurrent,
      totalLoaded: this.totalLoaded,
      totalFailed: this.totalFailed,
      averageLoadTime:
        this.totalLoaded > 0 ? this.totalLoadTime / this.totalLoaded : 0,
    };
  }

  resetStats(): void {
    this.totalLoaded = 0;
    this.totalFailed = 0;
    this.totalLoadTime = 0;
  }

  // =========================================================================
  // Debug
  // =========================================================================

  debug(): void {
    const stats = this.getStats();
    console.log('[Scheduler] Stats:', {
      ...stats,
      averageLoadTime: `${stats.averageLoadTime.toFixed(0)}ms`,
      queue: this.queue.toArray().slice(0, 5).map(item => ({
        id: item.item,
        priority: -item.priority, // Un-negate for display
      })),
    });
  }
}

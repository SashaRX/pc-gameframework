/**
 * Memory Pool for ArrayBuffer reuse
 * Reduces allocations and GC pressure during progressive loading
 */

export interface MemoryPoolStats {
  allocated: number;
  reused: number;
  peakUsage: number;
  currentUsage: number;
  poolSize: number;
}

interface PooledBuffer {
  buffer: ArrayBuffer;
  size: number;
  inUse: boolean;
  lastUsed: number;
}

export class MemoryPool {
  private pools: Map<number, PooledBuffer[]> = new Map();
  private stats: MemoryPoolStats = {
    allocated: 0,
    reused: 0,
    peakUsage: 0,
    currentUsage: 0,
    poolSize: 0,
  };

  // Size buckets for efficient allocation (powers of 2)
  private readonly SIZE_BUCKETS = [
    1024,        // 1 KB
    4096,        // 4 KB
    16384,       // 16 KB
    65536,       // 64 KB
    262144,      // 256 KB
    1048576,     // 1 MB
    4194304,     // 4 MB
    16777216,    // 16 MB
    67108864,    // 64 MB
  ];

  constructor(private maxPoolSize: number = 128 * 1024 * 1024) {} // 128 MB default

  /**
   * Get buffer from pool or allocate new one
   */
  acquire(size: number): ArrayBuffer {
    const bucketSize = this.findBucketSize(size);
    let pool = this.pools.get(bucketSize);

    if (!pool) {
      pool = [];
      this.pools.set(bucketSize, pool);
    }

    // Try to find available buffer in pool
    for (const pooled of pool) {
      if (!pooled.inUse && pooled.size >= size) {
        pooled.inUse = true;
        pooled.lastUsed = performance.now();
        this.stats.reused++;
        this.stats.currentUsage += pooled.size;

        if (this.stats.currentUsage > this.stats.peakUsage) {
          this.stats.peakUsage = this.stats.currentUsage;
        }

        return pooled.buffer;
      }
    }

    // No available buffer, allocate new one
    const buffer = new ArrayBuffer(bucketSize);
    const pooled: PooledBuffer = {
      buffer,
      size: bucketSize,
      inUse: true,
      lastUsed: performance.now(),
    };

    pool.push(pooled);
    this.stats.allocated++;
    this.stats.poolSize += bucketSize;
    this.stats.currentUsage += bucketSize;

    if (this.stats.currentUsage > this.stats.peakUsage) {
      this.stats.peakUsage = this.stats.currentUsage;
    }

    // Enforce pool size limit
    this.enforcePoolSizeLimit();

    return buffer;
  }

  /**
   * Return buffer to pool
   */
  release(buffer: ArrayBuffer): void {
    const size = buffer.byteLength;
    const bucketSize = this.findBucketSize(size);
    const pool = this.pools.get(bucketSize);

    if (!pool) return;

    for (const pooled of pool) {
      if (pooled.buffer === buffer && pooled.inUse) {
        pooled.inUse = false;
        pooled.lastUsed = performance.now();
        this.stats.currentUsage -= pooled.size;
        return;
      }
    }
  }

  /**
   * Clear all buffers from pool
   */
  clear(): void {
    this.pools.clear();
    this.stats.poolSize = 0;
    this.stats.currentUsage = 0;
  }

  /**
   * Get pool statistics
   */
  getStats(): MemoryPoolStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.stats.allocated = 0;
    this.stats.reused = 0;
    this.stats.peakUsage = 0;
  }

  /**
   * Find appropriate bucket size for requested size
   */
  private findBucketSize(size: number): number {
    for (const bucketSize of this.SIZE_BUCKETS) {
      if (bucketSize >= size) {
        return bucketSize;
      }
    }
    // For sizes larger than max bucket, round up to next MB
    return Math.ceil(size / 1048576) * 1048576;
  }

  /**
   * Enforce maximum pool size by removing least recently used buffers
   */
  private enforcePoolSizeLimit(): void {
    if (this.stats.poolSize <= this.maxPoolSize) return;

    // Collect all unused buffers with their metadata
    const unusedBuffers: Array<{ pooled: PooledBuffer; bucketSize: number }> = [];

    for (const [bucketSize, pool] of this.pools.entries()) {
      for (const pooled of pool) {
        if (!pooled.inUse) {
          unusedBuffers.push({ pooled, bucketSize });
        }
      }
    }

    // Sort by last used time (oldest first)
    unusedBuffers.sort((a, b) => a.pooled.lastUsed - b.pooled.lastUsed);

    // Remove oldest buffers until under limit
    for (const { pooled, bucketSize } of unusedBuffers) {
      if (this.stats.poolSize <= this.maxPoolSize) break;

      const pool = this.pools.get(bucketSize);
      if (pool) {
        const index = pool.indexOf(pooled);
        if (index !== -1) {
          pool.splice(index, 1);
          this.stats.poolSize -= pooled.size;
        }
      }
    }
  }
}

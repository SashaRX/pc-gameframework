/**
 * PriorityQueue - Min-Heap implementation with dynamic priority updates
 *
 * Features:
 * - O(log n) insertion
 * - O(log n) extraction of minimum
 * - O(log n) priority update
 * - O(1) peek
 * - Supports generic items with priority
 */

export interface PriorityItem<T> {
  item: T;
  priority: number;
}

export class PriorityQueue<T> {
  private heap: PriorityItem<T>[] = [];
  private indexMap: Map<T, number> = new Map(); // item -> heap index

  constructor() {}

  // =========================================================================
  // Core Operations
  // =========================================================================

  /**
   * Insert item with priority
   * Time: O(log n)
   */
  insert(item: T, priority: number): void {
    const index = this.heap.length;
    this.heap.push({ item, priority });
    this.indexMap.set(item, index);
    this.bubbleUp(index);
  }

  /**
   * Extract item with minimum priority
   * Time: O(log n)
   */
  extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;
    if (this.heap.length === 1) {
      const item = this.heap.pop()!;
      this.indexMap.delete(item.item);
      return item.item;
    }

    const min = this.heap[0];
    const last = this.heap.pop()!;
    this.heap[0] = last;
    this.indexMap.set(last.item, 0);
    this.indexMap.delete(min.item);
    this.bubbleDown(0);

    return min.item;
  }

  /**
   * Peek at item with minimum priority without removing
   * Time: O(1)
   */
  peek(): T | undefined {
    return this.heap[0]?.item;
  }

  /**
   * Update priority of existing item
   * Time: O(log n)
   */
  updatePriority(item: T, newPriority: number): void {
    const index = this.indexMap.get(item);
    if (index === undefined) {
      // Item not in queue, insert it
      this.insert(item, newPriority);
      return;
    }

    const oldPriority = this.heap[index].priority;
    this.heap[index].priority = newPriority;

    if (newPriority < oldPriority) {
      this.bubbleUp(index);
    } else if (newPriority > oldPriority) {
      this.bubbleDown(index);
    }
  }

  /**
   * Remove specific item
   * Time: O(log n)
   */
  remove(item: T): boolean {
    const index = this.indexMap.get(item);
    if (index === undefined) return false;

    if (index === this.heap.length - 1) {
      this.heap.pop();
      this.indexMap.delete(item);
      return true;
    }

    const last = this.heap.pop()!;
    this.heap[index] = last;
    this.indexMap.set(last.item, index);
    this.indexMap.delete(item);

    // Restore heap property
    const parent = this.getParent(index);
    if (parent !== undefined && this.heap[index].priority < this.heap[parent].priority) {
      this.bubbleUp(index);
    } else {
      this.bubbleDown(index);
    }

    return true;
  }

  /**
   * Check if item exists in queue
   * Time: O(1)
   */
  contains(item: T): boolean {
    return this.indexMap.has(item);
  }

  /**
   * Get priority of item
   * Time: O(1)
   */
  getPriority(item: T): number | undefined {
    const index = this.indexMap.get(item);
    return index !== undefined ? this.heap[index].priority : undefined;
  }

  // =========================================================================
  // Utility
  // =========================================================================

  get size(): number {
    return this.heap.length;
  }

  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  clear(): void {
    this.heap = [];
    this.indexMap.clear();
  }

  /**
   * Get all items sorted by priority (for debugging)
   */
  toArray(): PriorityItem<T>[] {
    return [...this.heap].sort((a, b) => a.priority - b.priority);
  }

  // =========================================================================
  // Heap Operations
  // =========================================================================

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = this.getParent(index);
      if (parent === undefined || this.heap[index].priority >= this.heap[parent].priority) {
        break;
      }

      this.swap(index, parent);
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      let smallest = index;
      const left = this.getLeftChild(index);
      const right = this.getRightChild(index);

      if (left !== undefined && this.heap[left].priority < this.heap[smallest].priority) {
        smallest = left;
      }

      if (right !== undefined && this.heap[right].priority < this.heap[smallest].priority) {
        smallest = right;
      }

      if (smallest === index) break;

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;

    // Update index map
    this.indexMap.set(this.heap[i].item, i);
    this.indexMap.set(this.heap[j].item, j);
  }

  private getParent(index: number): number | undefined {
    if (index === 0) return undefined;
    return Math.floor((index - 1) / 2);
  }

  private getLeftChild(index: number): number | undefined {
    const left = 2 * index + 1;
    return left < this.heap.length ? left : undefined;
  }

  private getRightChild(index: number): number | undefined {
    const right = 2 * index + 2;
    return right < this.heap.length ? right : undefined;
  }

  // =========================================================================
  // Debug
  // =========================================================================

  toString(): string {
    return this.heap
      .map((item, i) => `[${i}] ${item.priority}`)
      .join(', ');
  }

  /**
   * Validate heap property (for testing)
   */
  validate(): boolean {
    for (let i = 0; i < this.heap.length; i++) {
      const left = this.getLeftChild(i);
      const right = this.getRightChild(i);

      if (left !== undefined && this.heap[i].priority > this.heap[left].priority) {
        return false;
      }

      if (right !== undefined && this.heap[i].priority > this.heap[right].priority) {
        return false;
      }

      // Validate index map
      if (this.indexMap.get(this.heap[i].item) !== i) {
        return false;
      }
    }

    return true;
  }
}

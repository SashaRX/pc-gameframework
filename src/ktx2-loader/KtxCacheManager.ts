/**
 * KtxCacheManager - IndexedDB cache (заглушка)
 * TODO: Реализовать в Milestone C
 */

export class KtxCacheManager {
  constructor(dbName: string, version: number) {}
  
  async init(): Promise<void> {
    // TODO: implement
  }
  
  async clearOld(maxAgeDays: number): Promise<void> {
    // TODO: implement
  }
  
  async getMipList(url: string): Promise<number[]> {
    return [];
  }
  
  async loadMip(url: string, level: number): Promise<any> {
    return null;
  }
  
  async saveMip(url: string, level: number, data: Uint8Array, metadata: any): Promise<void> {
    // TODO: implement
  }
}
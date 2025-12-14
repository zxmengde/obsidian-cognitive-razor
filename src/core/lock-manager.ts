/**
 * SimpleLockManager：最小化的内存锁
 *
 * - 仅用于同一运行周期内的互斥控制
 * - 不做超时、不做持久化、不做定时清理
 */

export class SimpleLockManager {
  private processingCruids = new Set<string>();

  tryAcquire(cruid: string): boolean {
    if (this.processingCruids.has(cruid)) {
      return false;
    }
    this.processingCruids.add(cruid);
    return true;
  }

  release(cruid: string): void {
    this.processingCruids.delete(cruid);
  }

  isLocked(cruid: string): boolean {
    return this.processingCruids.has(cruid);
  }

  clear(): void {
    this.processingCruids.clear();
  }
}

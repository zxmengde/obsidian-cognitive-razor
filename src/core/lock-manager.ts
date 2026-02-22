/**
 * SimpleLockManager：带 TTL 的内存锁
 *
 * - 仅用于同一运行周期内的互斥控制
 * - 支持 TTL 超时自动释放，防止锁泄漏
 * - 不做持久化
 */

/** 默认锁超时时间：5 分钟 */
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

interface LockEntry {
  acquiredAt: number;
}

export class SimpleLockManager {
  private locks = new Map<string, LockEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_LOCK_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  tryAcquire(cruid: string): boolean {
    this.evictExpired(cruid);
    if (this.locks.has(cruid)) {
      return false;
    }
    this.locks.set(cruid, { acquiredAt: Date.now() });
    return true;
  }

  release(cruid: string): void {
    this.locks.delete(cruid);
  }

  isLocked(cruid: string): boolean {
    this.evictExpired(cruid);
    return this.locks.has(cruid);
  }

  clear(): void {
    this.locks.clear();
  }

  /** 全局过期扫描：清除所有超时锁（由外部定时器调用） */
  evictAllExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.locks) {
      if (now - entry.acquiredAt > this.ttlMs) {
        this.locks.delete(key);
      }
    }
  }

  /** 检查指定锁是否已超时，超时则自动释放 */
  private evictExpired(cruid: string): void {
    const entry = this.locks.get(cruid);
    if (entry && Date.now() - entry.acquiredAt > this.ttlMs) {
      this.locks.delete(cruid);
    }
  }
}

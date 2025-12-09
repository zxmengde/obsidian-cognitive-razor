/**
 * 锁管理器
 * 负责防止并发冲突，管理节点锁和类型锁
 */

import { ILockManager, LockRecord, Result, ok, err } from "../types";
import { ILogger } from "../types";

export class LockManager implements ILockManager {
  private locks: Map<string, LockRecord>;
  private logger: ILogger;
  private readonly LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟超时，防止僵尸锁
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(logger: ILogger) {
    this.locks = new Map();
    this.logger = logger;
    this.startCleanup();
    
    this.logger.debug("LockManager", "LockManager 初始化完成");
  }

  /**
   * 获取锁
   * @param key 锁键（nodeId 或 type）
   * @param type 锁类型
   * @param taskId 任务 ID
   * @returns 锁 ID 或错误
   */
  acquire(key: string, type: 'node' | 'type', taskId: string): Result<string> {
    this.cleanupExpiredLocks();
    // 检查是否已被锁定
    if (this.locks.has(key)) {
      const existingLock = this.locks.get(key)!;
      this.logger.warn("LockManager", `锁冲突: key=${key} 已被任务 ${existingLock.taskId} 持有`, {
        key,
        type,
        taskId,
        existingLock
      });
      
      return err(
        "E400",
        `锁冲突: ${key} 已被任务 ${existingLock.taskId} 持有`,
        { key, type, taskId, existingLock }
      );
    }

    // 创建锁记录
    const lockRecord: LockRecord = {
      key,
      type,
      taskId,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + this.LOCK_TIMEOUT_MS).toISOString()
    };

    // 存储锁
    this.locks.set(key, lockRecord);

    this.logger.info("LockManager", `锁已获取: key=${key}, type=${type}, taskId=${taskId}`, {
      lockRecord
    });

    return ok(key);
  }

  /**
   * 释放锁
   * @param lockId 锁 ID（即 key）
   */
  release(lockId: string): void {
    const lock = this.locks.get(lockId);
    
    if (!lock) {
      this.logger.warn("LockManager", `尝试释放不存在的锁: lockId=${lockId}`);
      return;
    }

    this.locks.delete(lockId);

    this.logger.info("LockManager", `锁已释放: lockId=${lockId}`, {
      lock
    });
  }

  /**
   * 检查是否被锁定
   * @param key 锁键
   */
  isLocked(key: string): boolean {
    return this.locks.has(key);
  }

  /**
   * 获取所有活跃锁
   */
  getActiveLocks(): LockRecord[] {
    this.cleanupExpiredLocks();
    return Array.from(this.locks.values());
  }

  /**
   * 从持久化状态恢复锁
   */
  restoreLocks(locks: LockRecord[]): void {
    this.locks.clear();

    for (const lock of locks) {
      if (!lock || !lock.key || !lock.taskId) continue;
      if (!lock.expiresAt) {
        lock.expiresAt = new Date(Date.now() + this.LOCK_TIMEOUT_MS).toISOString();
      }
      this.locks.set(lock.key, lock);
    }

    this.logger.info("LockManager", `锁状态已恢复，共 ${this.locks.size} 个`, {
      keys: Array.from(this.locks.keys())
    });
  }

  /**
   * 释放任务持有的所有锁
   * @param taskId 任务 ID
   */
  releaseByTaskId(taskId: string): void {
    const locksToRelease: string[] = [];

    for (const [key, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        locksToRelease.push(key);
      }
    }

    for (const key of locksToRelease) {
      this.release(key);
    }

    if (locksToRelease.length > 0) {
      this.logger.info("LockManager", `释放任务 ${taskId} 持有的 ${locksToRelease.length} 个锁`, {
        taskId,
        locks: locksToRelease
      });
    }
  }

  /**
   * 清空所有锁（用于测试或重置）
   */
  clear(): void {
    const count = this.locks.size;
    this.locks.clear();
    this.logger.info("LockManager", `清空所有锁，共 ${count} 个`);
  }

  /**
   * 停止清理任务（用于卸载时释放定时器）
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 定期清理过期锁，避免僵尸锁长期占用
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const released = this.cleanupExpiredLocks();
      if (released > 0) {
        this.logger.warn("LockManager", `清理过期锁 ${released} 个`);
      }
    }, 60 * 1000);
  }

  private cleanupExpiredLocks(): number {
    const now = Date.now();
    let released = 0;

    for (const [key, lock] of this.locks.entries()) {
      if (lock.expiresAt) {
        const expiresAt = new Date(lock.expiresAt).getTime();
        if (Number.isFinite(expiresAt) && expiresAt < now) {
          this.locks.delete(key);
          released++;
        }
      }
    }

    return released;
  }
}

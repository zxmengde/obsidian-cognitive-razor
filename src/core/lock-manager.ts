/**
 * LockManager 组件
 * 负责节点锁和类型锁的管理，防止并发冲突
 * 验证需求：6.2
 */

import { Result, ok, err } from "../types";

/**
 * 锁类型
 */
export type LockType = "node" | "type";

/**
 * 锁记录
 */
export interface Lock {
  /** 锁键（nodeId 或 type） */
  key: string;
  /** 锁类型 */
  type: LockType;
  /** 持有锁的任务 ID */
  taskId: string;
  /** 获取时间 */
  acquiredAt: string;
}

/**
 * LockManager 组件
 */
export class LockManager {
  /** 当前持有的锁 Map<lockKey, Lock> */
  private locks: Map<string, Lock>;

  constructor() {
    this.locks = new Map();
  }

  /**
   * 尝试获取节点锁
   * 如果节点已被锁定，返回失败
   */
  acquireNodeLock(nodeId: string, taskId: string): Result<void> {
    const lockKey = `node:${nodeId}`;

    // 检查是否已被锁定
    if (this.locks.has(lockKey)) {
      const existingLock = this.locks.get(lockKey)!;
      return err(
        "LOCK_CONFLICT",
        `节点 ${nodeId} 已被任务 ${existingLock.taskId} 锁定`,
        { existingLock }
      );
    }

    // 获取锁
    const lock: Lock = {
      key: lockKey,
      type: "node",
      taskId,
      acquiredAt: new Date().toISOString(),
    };

    this.locks.set(lockKey, lock);
    return ok(undefined);
  }

  /**
   * 尝试获取类型锁
   * 如果类型已被锁定，返回失败
   */
  acquireTypeLock(type: string, taskId: string): Result<void> {
    const lockKey = `type:${type}`;

    // 检查是否已被锁定
    if (this.locks.has(lockKey)) {
      const existingLock = this.locks.get(lockKey)!;
      return err(
        "LOCK_CONFLICT",
        `类型 ${type} 已被任务 ${existingLock.taskId} 锁定`,
        { existingLock }
      );
    }

    // 获取锁
    const lock: Lock = {
      key: lockKey,
      type: "type",
      taskId,
      acquiredAt: new Date().toISOString(),
    };

    this.locks.set(lockKey, lock);
    return ok(undefined);
  }

  /**
   * 释放节点锁
   */
  releaseNodeLock(nodeId: string, taskId: string): Result<void> {
    const lockKey = `node:${nodeId}`;

    // 检查锁是否存在
    if (!this.locks.has(lockKey)) {
      return err(
        "LOCK_NOT_FOUND",
        `节点 ${nodeId} 的锁不存在`,
        { nodeId, taskId }
      );
    }

    const lock = this.locks.get(lockKey)!;

    // 检查是否是锁的持有者
    if (lock.taskId !== taskId) {
      return err(
        "LOCK_NOT_OWNER",
        `任务 ${taskId} 不是节点 ${nodeId} 锁的持有者`,
        { lock, taskId }
      );
    }

    // 释放锁
    this.locks.delete(lockKey);
    return ok(undefined);
  }

  /**
   * 释放类型锁
   */
  releaseTypeLock(type: string, taskId: string): Result<void> {
    const lockKey = `type:${type}`;

    // 检查锁是否存在
    if (!this.locks.has(lockKey)) {
      return err(
        "LOCK_NOT_FOUND",
        `类型 ${type} 的锁不存在`,
        { type, taskId }
      );
    }

    const lock = this.locks.get(lockKey)!;

    // 检查是否是锁的持有者
    if (lock.taskId !== taskId) {
      return err(
        "LOCK_NOT_OWNER",
        `任务 ${taskId} 不是类型 ${type} 锁的持有者`,
        { lock, taskId }
      );
    }

    // 释放锁
    this.locks.delete(lockKey);
    return ok(undefined);
  }

  /**
   * 释放任务持有的所有锁
   * 用于任务完成或取消时清理
   */
  releaseAllLocksForTask(taskId: string): Result<number> {
    let releasedCount = 0;

    // 遍历所有锁，释放属于该任务的锁
    for (const [lockKey, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(lockKey);
        releasedCount++;
      }
    }

    return ok(releasedCount);
  }

  /**
   * 检查节点是否被锁定
   */
  isNodeLocked(nodeId: string): boolean {
    const lockKey = `node:${nodeId}`;
    return this.locks.has(lockKey);
  }

  /**
   * 检查类型是否被锁定
   */
  isTypeLocked(type: string): boolean {
    const lockKey = `type:${type}`;
    return this.locks.has(lockKey);
  }

  /**
   * 获取节点锁信息
   */
  getNodeLock(nodeId: string): Lock | undefined {
    const lockKey = `node:${nodeId}`;
    return this.locks.get(lockKey);
  }

  /**
   * 获取类型锁信息
   */
  getTypeLock(type: string): Lock | undefined {
    const lockKey = `type:${type}`;
    return this.locks.get(lockKey);
  }

  /**
   * 获取任务持有的所有锁
   */
  getLocksForTask(taskId: string): Lock[] {
    const taskLocks: Lock[] = [];

    for (const lock of this.locks.values()) {
      if (lock.taskId === taskId) {
        taskLocks.push(lock);
      }
    }

    return taskLocks;
  }

  /**
   * 获取所有锁
   */
  getAllLocks(): Lock[] {
    return Array.from(this.locks.values());
  }

  /**
   * 获取锁数量
   */
  getLockCount(): number {
    return this.locks.size;
  }

  /**
   * 清除所有锁（用于测试或重置）
   */
  clearAllLocks(): void {
    this.locks.clear();
  }
}

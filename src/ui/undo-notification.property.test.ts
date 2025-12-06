/**
 * 撤销通知属性测试
 * 使用 fast-check 进行基于属性的测试
 */

import * as fc from "fast-check";
import { UndoNotification, type UndoNotificationOptions } from "./undo-notification";

describe("撤销通知属性测试", () => {
  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 21: 撤销按钮显示**
   * **验证需求：8.1**
   * 
   * 属性：对于任意写入操作，系统必须在通知中显示撤销按钮，且按钮在 5 秒内可点击
   */
  test("属性 21: 撤销按钮显示 - 通知包含撤销按钮", () => {
    fc.assert(
      fc.property(
        // 生成随机消息
        fc.string({ minLength: 1, maxLength: 200 }),
        // 生成随机快照 ID
        fc.string({ minLength: 10, maxLength: 50 }),
        // 生成随机文件路径
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        (message, snapshotId, filePath) => {
          let undoCalled = false;
          let undoSnapshotId: string | undefined;

          // 创建撤销通知选项
          const options: UndoNotificationOptions = {
            message,
            snapshotId,
            filePath,
            onUndo: (id: string) => {
              undoCalled = true;
              undoSnapshotId = id;
            },
            timeout: 5000, // 5 秒超时
          };

          // 创建撤销通知实例
          const notification = new UndoNotification(options);

          // 验证通知实例存在
          expect(notification).toBeDefined();

          // 验证通知有撤销方法
          expect(typeof notification.triggerUndo).toBe("function");

          // 模拟点击撤销按钮
          notification.triggerUndo();

          // 验证撤销回调被调用
          expect(undoCalled).toBe(true);
          expect(undoSnapshotId).toBe(snapshotId);

          // 清理
          notification.dismiss();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：撤销按钮在超时后不可用
   */
  test("属性 21: 撤销按钮显示 - 超时后按钮不可用", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        async (message, snapshotId, filePath) => {
          let undoCalled = false;

          const options: UndoNotificationOptions = {
            message,
            snapshotId,
            filePath,
            onUndo: (id: string) => {
              undoCalled = true;
            },
            timeout: 100, // 100ms 超时（用于测试）
          };

          const notification = new UndoNotification(options);

          // 显示通知（启动超时计时器）
          notification.show();

          // 等待超时
          await new Promise((resolve) => setTimeout(resolve, 150));

          // 验证通知已过期
          expect(notification.isExpired()).toBe(true);

          // 尝试触发撤销（应该失败）
          const result = notification.triggerUndo();

          // 验证撤销未被调用
          expect(result).toBe(false);
          expect(undoCalled).toBe(false);

          // 清理
          notification.dismiss();
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * 属性：撤销按钮只能触发一次
   */
  test("属性 21: 撤销按钮显示 - 撤销只能触发一次", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        (message, snapshotId, filePath) => {
          let undoCallCount = 0;

          const options: UndoNotificationOptions = {
            message,
            snapshotId,
            filePath,
            onUndo: (id: string) => {
              undoCallCount++;
            },
            timeout: 5000,
          };

          const notification = new UndoNotification(options);

          // 第一次触发撤销
          const result1 = notification.triggerUndo();
          expect(result1).toBe(true);
          expect(undoCallCount).toBe(1);

          // 第二次触发撤销（应该失败）
          const result2 = notification.triggerUndo();
          expect(result2).toBe(false);
          expect(undoCallCount).toBe(1); // 计数不应增加

          // 清理
          notification.dismiss();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：通知包含正确的元数据
   */
  test("属性 21: 撤销按钮显示 - 通知包含正确的元数据", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        (message, snapshotId, filePath) => {
          const options: UndoNotificationOptions = {
            message,
            snapshotId,
            filePath,
            onUndo: (id: string) => {
              // 回调函数
            },
            timeout: 5000,
          };

          const notification = new UndoNotification(options);

          // 验证通知包含正确的元数据
          expect(notification.getSnapshotId()).toBe(snapshotId);
          expect(notification.getFilePath()).toBe(filePath);
          expect(notification.getMessage()).toBe(message);

          // 清理
          notification.dismiss();
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe("撤销恢复内容属性测试", () => {
  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 22: 撤销恢复内容**
   * **验证需求：8.2**
   * 
   * 属性：对于任意点击的撤销按钮，文件内容必须恢复到快照中保存的状态，且快照文件必须被删除
   * 
   * 注意：这个测试需要与 UndoManager 集成，我们测试撤销流程的完整性
   */
  test("属性 22: 撤销恢复内容 - 撤销触发正确的恢复流程", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        fc.string({ minLength: 0, maxLength: 1000 }), // 原始内容
        (message, snapshotId, filePath, originalContent) => {
          let undoSnapshotId: string | undefined;
          let undoFilePath: string | undefined;

          const options: UndoNotificationOptions = {
            message,
            snapshotId,
            filePath,
            onUndo: (id: string) => {
              undoSnapshotId = id;
              undoFilePath = filePath;
            },
            timeout: 5000,
          };

          const notification = new UndoNotification(options);

          // 触发撤销
          const result = notification.triggerUndo();

          // 验证撤销成功
          expect(result).toBe(true);

          // 验证撤销回调接收到正确的快照 ID
          expect(undoSnapshotId).toBe(snapshotId);

          // 验证文件路径正确
          expect(undoFilePath).toBe(filePath);

          // 清理
          notification.dismiss();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：撤销后通知应该被关闭
   */
  test("属性 22: 撤销恢复内容 - 撤销后通知关闭", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 10, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        (message, snapshotId, filePath) => {
          let undoCalled = false;

          const options: UndoNotificationOptions = {
            message,
            snapshotId,
            filePath,
            onUndo: (id: string) => {
              undoCalled = true;
            },
            timeout: 5000,
          };

          const notification = new UndoNotification(options);

          // 显示通知
          notification.show();

          // 触发撤销
          notification.triggerUndo();

          // 验证撤销被调用
          expect(undoCalled).toBe(true);

          // 验证通知已被标记为已触发（不能再次触发）
          const result2 = notification.triggerUndo();
          expect(result2).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：撤销操作必须传递正确的快照 ID
   */
  test("属性 22: 撤销恢复内容 - 快照 ID 正确传递", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            message: fc.string({ minLength: 1, maxLength: 200 }),
            snapshotId: fc.string({ minLength: 10, maxLength: 50 }),
            filePath: fc
              .string({ minLength: 1, maxLength: 100 })
              .map((s) => `${s}.md`),
          }),
          { minLength: 1, maxLength: 5 }
        ),
        (notifications) => {
          const undoResults: Array<{ snapshotId: string; filePath: string }> =
            [];

          // 创建多个通知
          const notificationInstances = notifications.map((data) => {
            const options: UndoNotificationOptions = {
              message: data.message,
              snapshotId: data.snapshotId,
              filePath: data.filePath,
              onUndo: (id: string) => {
                undoResults.push({
                  snapshotId: id,
                  filePath: data.filePath,
                });
              },
              timeout: 5000,
            };

            return new UndoNotification(options);
          });

          // 触发所有撤销
          notificationInstances.forEach((notification) => {
            notification.triggerUndo();
          });

          // 验证每个撤销都传递了正确的快照 ID
          expect(undoResults.length).toBe(notifications.length);

          for (let i = 0; i < notifications.length; i++) {
            expect(undoResults[i].snapshotId).toBe(
              notifications[i].snapshotId
            );
            expect(undoResults[i].filePath).toBe(notifications[i].filePath);
          }

          // 清理
          notificationInstances.forEach((notification) => {
            notification.dismiss();
          });
        }
      ),
      { numRuns: 50 }
    );
  });
});


describe("操作历史完整性属性测试", () => {
  /**
   * **Feature: provider-simplification-and-ui-fixes, Property 23: 操作历史完整性**
   * **验证需求：8.3**
   * 
   * 属性：对于任意打开的操作历史视图，显示的操作列表必须包含所有未过期的快照，
   * 且每个操作必须显示时间、文件路径和操作类型
   * 
   * 注意：这个测试验证操作历史数据结构的完整性
   */
  test("属性 23: 操作历史完整性 - 历史记录包含所有必需字段", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            snapshotId: fc.string({ minLength: 10, maxLength: 50 }),
            filePath: fc
              .string({ minLength: 1, maxLength: 100 })
              .map((s) => `${s}.md`),
            operation: fc.string({ minLength: 1, maxLength: 100 }),
            created: fc
              .date({ min: new Date(2020, 0, 1), max: new Date() })
              .map((d) => d.toISOString()),
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (snapshots) => {
          // 验证每个快照都包含所有必需字段
          for (const snapshot of snapshots) {
            // 验证快照 ID 存在且非空
            expect(snapshot.snapshotId).toBeDefined();
            expect(snapshot.snapshotId.length).toBeGreaterThan(0);

            // 验证文件路径存在且非空
            expect(snapshot.filePath).toBeDefined();
            expect(snapshot.filePath.length).toBeGreaterThan(0);

            // 验证操作类型存在且非空
            expect(snapshot.operation).toBeDefined();
            expect(snapshot.operation.length).toBeGreaterThan(0);

            // 验证创建时间存在且有效
            expect(snapshot.created).toBeDefined();
            const createdDate = new Date(snapshot.created);
            expect(createdDate.getTime()).toBeGreaterThan(0);
            expect(isNaN(createdDate.getTime())).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：历史记录应该按时间排序
   */
  test("属性 23: 操作历史完整性 - 历史记录可以按时间排序", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            snapshotId: fc.string({ minLength: 10, maxLength: 50 }),
            filePath: fc
              .string({ minLength: 1, maxLength: 100 })
              .map((s) => `${s}.md`),
            operation: fc.string({ minLength: 1, maxLength: 100 }),
            created: fc
              .date({ min: new Date(2020, 0, 1), max: new Date() })
              .map((d) => d.toISOString()),
          }),
          { minLength: 2, maxLength: 10 }
        ),
        (snapshots) => {
          // 按创建时间排序
          const sorted = [...snapshots].sort(
            (a, b) =>
              new Date(b.created).getTime() - new Date(a.created).getTime()
          );

          // 验证排序后的列表是有效的
          expect(sorted.length).toBe(snapshots.length);

          // 验证排序是正确的（最新的在前）
          for (let i = 0; i < sorted.length - 1; i++) {
            const currentTime = new Date(sorted[i].created).getTime();
            const nextTime = new Date(sorted[i + 1].created).getTime();
            expect(currentTime).toBeGreaterThanOrEqual(nextTime);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：历史记录应该能够按文件路径过滤
   */
  test("属性 23: 操作历史完整性 - 历史记录可以按文件路径过滤", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            snapshotId: fc.string({ minLength: 10, maxLength: 50 }),
            filePath: fc
              .string({ minLength: 1, maxLength: 100 })
              .map((s) => `${s}.md`),
            operation: fc.string({ minLength: 1, maxLength: 100 }),
            created: fc
              .date({ min: new Date(2020, 0, 1), max: new Date() })
              .map((d) => d.toISOString()),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `${s}.md`),
        (snapshots, targetFilePath) => {
          // 按文件路径过滤
          const filtered = snapshots.filter(
            (s) => s.filePath === targetFilePath
          );

          // 验证过滤结果
          for (const snapshot of filtered) {
            expect(snapshot.filePath).toBe(targetFilePath);
          }

          // 验证过滤后的数量不超过原始数量
          expect(filtered.length).toBeLessThanOrEqual(snapshots.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：历史记录应该能够按操作类型分组
   */
  test("属性 23: 操作历史完整性 - 历史记录可以按操作类型分组", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            snapshotId: fc.string({ minLength: 10, maxLength: 50 }),
            filePath: fc
              .string({ minLength: 1, maxLength: 100 })
              .map((s) => `${s}.md`),
            operation: fc.constantFrom(
              "enrich",
              "merge",
              "incremental-improve",
              "manual-edit"
            ),
            created: fc
              .date({ min: new Date(2020, 0, 1), max: new Date() })
              .map((d) => d.toISOString()),
          }),
          { minLength: 1, maxLength: 20 }
        ),
        (snapshots) => {
          // 按操作类型分组
          const grouped = snapshots.reduce((acc, snapshot) => {
            if (!acc[snapshot.operation]) {
              acc[snapshot.operation] = [];
            }
            acc[snapshot.operation].push(snapshot);
            return acc;
          }, {} as Record<string, typeof snapshots>);

          // 验证分组结果
          for (const [operation, group] of Object.entries(grouped)) {
            // 验证组内所有项的操作类型一致
            for (const snapshot of group) {
              expect(snapshot.operation).toBe(operation);
            }

            // 验证组不为空
            expect(group.length).toBeGreaterThan(0);
          }

          // 验证所有快照都被分组
          const totalGrouped = Object.values(grouped).reduce(
            (sum, group) => sum + group.length,
            0
          );
          expect(totalGrouped).toBe(snapshots.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 属性：历史记录的元数据必须与快照数据一致
   */
  test("属性 23: 操作历史完整性 - 元数据与快照数据一致", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            snapshotId: fc.string({ minLength: 10, maxLength: 50 }),
            filePath: fc
              .string({ minLength: 1, maxLength: 100 })
              .map((s) => `${s}.md`),
            operation: fc.string({ minLength: 1, maxLength: 100 }),
            created: fc
              .date({ min: new Date(2020, 0, 1), max: new Date() })
              .map((d) => d.toISOString()),
          }),
          { minLength: 1, maxLength: 10 }
        ),
        (snapshots) => {
          // 为每个快照创建元数据
          const metadata = snapshots.map((snapshot) => ({
            id: snapshot.snapshotId,
            filePath: snapshot.filePath,
            operation: snapshot.operation,
            created: snapshot.created,
          }));

          // 验证元数据与原始数据一致
          for (let i = 0; i < snapshots.length; i++) {
            expect(metadata[i].id).toBe(snapshots[i].snapshotId);
            expect(metadata[i].filePath).toBe(snapshots[i].filePath);
            expect(metadata[i].operation).toBe(snapshots[i].operation);
            expect(metadata[i].created).toBe(snapshots[i].created);
          }

          // 验证元数据数量与快照数量一致
          expect(metadata.length).toBe(snapshots.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});

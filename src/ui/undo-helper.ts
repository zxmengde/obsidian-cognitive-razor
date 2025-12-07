/**
 * 撤销辅助函数
 * 提供便捷的撤销通知显示和处理功能
 */

import { App, TFile } from "obsidian";
import { UndoNotification } from "./undo-notification";
import type { UndoManager } from "../core/undo-manager";

/**
 * 写入文件并显示撤销通知
 * 
 * @param app Obsidian App 实例
 * @param undoManager UndoManager 实例
 * @param filePath 文件路径
 * @param newContent 新内容
 * @param taskId 关联的任务 ID
 * @param nodeId 可选的节点 ID
 * @returns 是否成功
 */
export async function writeFileWithUndo(
  app: App,
  undoManager: UndoManager,
  filePath: string,
  newContent: string,
  taskId: string,
  nodeId?: string
): Promise<boolean> {
  try {
    // 1. 读取当前文件内容
    const file = app.vault.getAbstractFileByPath(filePath);
    let currentContent = "";

    if (file && file instanceof TFile) {
      currentContent = await app.vault.read(file);
    }

    // 2. 创建快照
    const snapshotResult = await undoManager.createSnapshot(
      filePath,
      currentContent,
      taskId,
      nodeId
    );

    if (!snapshotResult.ok) {
      console.error("创建快照失败:", snapshotResult.error);
      // 继续写入，但不提供撤销功能
    }

    // 3. 写入新内容
    if (file && file instanceof TFile) {
      await app.vault.modify(file, newContent);
    } else {
      // 文件不存在，创建新文件
      await app.vault.create(filePath, newContent);
    }

    // 4. 显示撤销通知
    if (snapshotResult.ok) {
      const notification = new UndoNotification({
        message: "操作完成",
        snapshotId: snapshotResult.value,
        filePath,
        onUndo: async (snapshotId: string) => {
          await handleUndo(app, undoManager, snapshotId);
        },
        timeout: 5000,
      });

      notification.show();
    }

    return true;
  } catch (error) {
    console.error("写入文件失败:", error);
    return false;
  }
}

/**
 * 处理撤销操作
 * 
 * @param app Obsidian App 实例
 * @param undoManager UndoManager 实例
 * @param snapshotId 快照 ID
 */
async function handleUndo(
  app: App,
  undoManager: UndoManager,
  snapshotId: string
): Promise<void> {
  try {
    // 1. 恢复快照
    const restoreResult = await undoManager.restoreSnapshot(snapshotId);
    if (!restoreResult.ok) {
      console.error("恢复快照失败:", restoreResult.error);
      return;
    }

    const snapshot = restoreResult.value;

    // 2. 写入文件（使用 snapshot.path）
    const file = app.vault.getAbstractFileByPath(snapshot.path);
    if (file && file instanceof TFile) {
      await app.vault.modify(file, snapshot.content);
    } else {
      // 文件不存在，创建文件
      await app.vault.create(snapshot.path, snapshot.content);
    }

    // 3. 删除快照
    const deleteResult = await undoManager.deleteSnapshot(snapshotId);
    if (!deleteResult.ok) {
      console.error("UndoHelper", "删除快照失败", deleteResult.error);
      // 但不影响撤销操作
    }

    console.log("UndoHelper", "撤销操作完成", { snapshotId });
  } catch (error) {
    console.error("UndoHelper", "撤销操作失败", error);
  }
}

/**
 * 创建快照（不写入文件）
 * 用于在写入前手动创建快照
 * 
 * @param app Obsidian App 实例
 * @param undoManager UndoManager 实例
 * @param filePath 文件路径
 * @param taskId 关联的任务 ID
 * @param nodeId 可选的节点 ID
 * @returns 快照 ID，如果失败返回 null
 */
export async function createSnapshotForFile(
  app: App,
  undoManager: UndoManager,
  filePath: string,
  taskId: string,
  nodeId?: string
): Promise<string | null> {
  try {
    // 读取当前文件内容
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      console.error("文件不存在:", filePath);
      return null;
    }

    const content = await app.vault.read(file);

    // 创建快照
    const snapshotResult = await undoManager.createSnapshot(
      filePath,
      content,
      taskId,
      nodeId
    );

    if (!snapshotResult.ok) {
      console.error("创建快照失败:", snapshotResult.error);
      return null;
    }

    return snapshotResult.value;
  } catch (error) {
    console.error("创建快照失败:", error);
    return null;
  }
}

/**
 * 显示撤销通知（用于已有快照的情况）
 * 
 * @param app Obsidian App 实例
 * @param undoManager UndoManager 实例
 * @param snapshotId 快照 ID
 * @param filePath 文件路径
 * @param operation 操作描述
 */
export function showUndoNotification(
  app: App,
  undoManager: UndoManager,
  snapshotId: string,
  filePath: string,
  operation: string
): void {
  const notification = new UndoNotification({
    message: `${operation}完成`,
    snapshotId,
    filePath,
    onUndo: async (id: string) => {
      await handleUndo(app, undoManager, id);
    },
    timeout: 5000,
  });

  notification.show();
}

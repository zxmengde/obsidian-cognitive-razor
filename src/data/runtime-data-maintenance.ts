/** 运行数据维护：只保护插件设置和运行态，不包含 Markdown 笔记。 */
import { ok, err } from "../types";
import type { Result } from "../types";
import type { Vault } from "obsidian";
import { FileStorage } from "./file-storage";

const RESET_MARKER = "data/reset-in-progress.json";
interface ResetSnapshot { version: 1; backupRoot: string; files: string[] }

function isRuntimePath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("data/") &&
    !path.startsWith("data/backups/") && path !== RESET_MARKER &&
    !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
function parseSnapshot(content: string): ResetSnapshot | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<ResetSnapshot> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed.backupRoot !== "string" ||
      !/^data\/backups\/reset-[\w-]+$/.test(parsed.backupRoot) ||
      !Array.isArray(parsed.files) || !parsed.files.every(isRuntimePath) ||
      new Set(parsed.files).size !== parsed.files.length) return undefined;
    return parsed as ResetSnapshot;
  } catch { return undefined; }
}
async function copyVerified(storage: FileStorage, from: string, to: string): Promise<Result<void>> {
  const content = await storage.read(from);
  if (!content.ok) return content;
  const written = await storage.write(to, content.value);
  if (!written.ok) return written;
  const confirmed = await storage.read(to);
  if (!confirmed.ok) return confirmed;
  return confirmed.value === content.value ? ok(undefined) : err("E500_INTERNAL_ERROR", `运行数据复制校验失败: ${to}`);
}

/** Recover before loading queues/workflows and before .bak/.tmp recovery.
 * Keep marker and backup intact on failure, so startup cannot schedule from
 * a partial set of runtime files. No model call is made here. */
export async function recoverInterruptedReset(storage: FileStorage): Promise<Result<void>> {
  const marker = await storage.read(RESET_MARKER);
  if (!marker.ok) return marker.error.code === "E301_FILE_NOT_FOUND" ? ok(undefined) : marker;
  const snapshot = parseSnapshot(marker.value);
  if (!snapshot) return err("E310_INVALID_STATE", "重置恢复标记损坏，已停止启动任务。请保留 data/backups 中的备份并检查 data/reset-in-progress.json；不要直接删除标记。");
  for (const path of snapshot.files) {
    const restored = await copyVerified(storage, `${snapshot.backupRoot}/runtime/${path.slice("data/".length)}`, path);
    if (!restored.ok) return err(restored.error.code, `恢复重置前运行数据失败，已停止启动任务。备份保留在 ${snapshot.backupRoot}；修复存储问题后重载插件。`, restored.error);
  }
  return storage.delete(RESET_MARKER);
}

/** Copy and verify everything before deleting anything; rollback interrupted clears. */
export async function backupAndClearPluginData(vault: Vault, pluginDir: string, settingsSnapshot: unknown): Promise<Result<void>> {
  try {
    const storage = new FileStorage(vault, pluginDir);
    const initialized = await storage.initialize();
    if (!initialized.ok) return initialized;
    const recovered = await recoverInterruptedReset(storage);
    if (!recovered.ok) return recovered;
    const listed = await storage.listFilesRecursive("data", ["data/backups"]);
    if (!listed.ok) return listed;
    const files = listed.value.filter((path) => !path.startsWith("data/backups/") && path !== RESET_MARKER);
    const backupRoot = `data/backups/reset-${Date.now()}-${crypto.randomUUID()}`;
    const settingsBytes = JSON.stringify(settingsSnapshot, null, 2);
    const settingsBackup = await storage.write(`${backupRoot}/settings.json`, settingsBytes);
    if (!settingsBackup.ok) return settingsBackup;
    const confirmedSettings = await storage.read(`${backupRoot}/settings.json`);
    if (!confirmedSettings.ok) return confirmedSettings;
    if (confirmedSettings.value !== settingsBytes) return err("E500_INTERNAL_ERROR", "设置备份校验失败；原运行数据未删除");
    for (const path of files) {
      const copied = await copyVerified(storage, path, `${backupRoot}/runtime/${path.slice("data/".length)}`);
      if (!copied.ok) return copied;
    }
    const snapshot: ResetSnapshot = { version: 1, backupRoot, files };
    const manifest = JSON.stringify(snapshot, null, 2);
    const savedManifest = await storage.write(`${backupRoot}/manifest.json`, manifest);
    if (!savedManifest.ok) return savedManifest;
    const confirmedManifest = await storage.read(`${backupRoot}/manifest.json`);
    if (!confirmedManifest.ok) return confirmedManifest;
    if (confirmedManifest.value !== manifest) return err("E500_INTERNAL_ERROR", "备份清单校验失败；原运行数据未删除");
    // A partial marker fails closed. No original is removed before exact readback.
    const marked = await storage.write(RESET_MARKER, manifest);
    if (!marked.ok) return marked;
    const verifiedMarker = await storage.read(RESET_MARKER);
    if (!verifiedMarker.ok) return verifiedMarker;
    if (verifiedMarker.value !== manifest) return err("E500_INTERNAL_ERROR", "重置标记校验失败；原运行数据未删除");
    for (const path of files) {
      const removed = await storage.delete(path);
      if (!removed.ok) {
        const restored = await recoverInterruptedReset(storage);
        return restored.ok ? err(removed.error.code, "重置未完成，已恢复重置前运行数据；没有自动重试模型请求。请排除存储问题后重试。", removed.error) : restored;
      }
    }
    const finished = await storage.delete(RESET_MARKER);
    if (!finished.ok) {
      // Adapters can report failure after a delete has committed. Confirm
      // absence as success; do not mislabel an absent marker as rollback.
      const remainingMarker = await storage.read(RESET_MARKER);
      if (!remainingMarker.ok && remainingMarker.error.code === "E301_FILE_NOT_FOUND") return ok(undefined);
      if (!remainingMarker.ok) return err(remainingMarker.error.code, `无法确认重置是否完成；完整备份保留在 ${backupRoot}。请修复存储问题后重载插件。`, remainingMarker.error);
      const restored = await recoverInterruptedReset(storage);
      return restored.ok ? err(finished.error.code, "重置确认失败，已恢复重置前运行数据", finished.error) : restored;
    }
    return ok(undefined);
  } catch (cause) { return err("E500_INTERNAL_ERROR", "备份并重置运行数据失败", cause); }
}

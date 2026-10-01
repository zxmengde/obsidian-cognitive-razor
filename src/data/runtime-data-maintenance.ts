/** 运行数据维护：不可逆重置操作前的完整快照与清空。 */

import { ok, err } from "../types";
import type { Result } from "../types";
import type { Vault } from "obsidian";
import { FileStorage } from "./file-storage";

/**
 * Copies every file under the plugin data directory (previous backups
 * excluded) into a timestamped backup folder, writes the settings snapshot
 * alongside, then removes the originals. Stops at the first failed step so a
 * partial reset never silently destroys data.
 */
export async function backupAndClearPluginData(
  vault: Vault,
  pluginDir: string,
  settingsSnapshot: unknown,
): Promise<Result<void>> {
  try {
    const storage = new FileStorage(vault, pluginDir);
    const initialized = await storage.initialize();
    if (!initialized.ok) return initialized;
    const listed = await storage.listFilesRecursive("data");
    if (!listed.ok) return listed as Result<void>;
    const files = listed.value.filter((path) => !path.startsWith("data/backups/"));
    const backupRoot = `data/backups/reset-${Date.now()}`;
    const settingsBackup = await storage.write(
      `${backupRoot}/settings.json`,
      JSON.stringify(settingsSnapshot, null, 2),
    );
    if (!settingsBackup.ok) return settingsBackup;
    for (const path of files) {
      const content = await storage.read(path);
      if (!content.ok) return content as Result<void>;
      const target = `${backupRoot}/${path.slice("data/".length)}`;
      const written = await storage.write(target, content.value);
      if (!written.ok) return written;
      const removed = await storage.delete(path);
      if (!removed.ok) return removed;
    }
    return ok(undefined);
  } catch (cause) {
    return err("E500_INTERNAL_ERROR", "备份并重置运行数据失败", cause);
  }
}

/**
 * 将本地构建产物与提示词模板同步到指定 Obsidian 笔记库的插件目录，并校验 SHA-256。
 * 用法：
 *   node scripts/sync-vault.mjs --vault "C:/path/to/vault" [--skip-build] [--no-reload]
 * 或通过环境变量 CR_OBSIDIAN_VAULT 指定目标笔记库路径。
 * 严禁触碰目标目录内的 data.json 或笔记库内任何笔记。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR_NAME = "obsidian-cognitive-razor";
const PLUGIN_ID = "cognitive-razor";
const STATIC_FILES = ["main.js", "manifest.json", "styles.css"];

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function parseArgs(argv) {
  let vaultPath = process.env.CR_OBSIDIAN_VAULT || "";
  let skipBuild = false;
  let reload = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--vault" && argv[i + 1]) {
      vaultPath = argv[++i];
    } else if (arg.startsWith("--vault=")) {
      vaultPath = arg.slice("--vault=".length);
    } else if (arg === "--skip-build") {
      skipBuild = true;
    } else if (arg === "--no-reload") {
      reload = false;
    }
  }
  return { vaultPath: vaultPath.trim(), skipBuild, reload };
}

function listFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results.sort();
}

function syncPrompts(srcPromptsDir, dstPromptsDir) {
  const srcFiles = listFilesRecursive(srcPromptsDir);
  const expectedRelLower = new Set(
    srcFiles.map((file) => relative(srcPromptsDir, file).toLowerCase()),
  );

  // 清理目标 prompts/ 下已删除的旧模板文件，但不触碰 prompts/ 外的任何文件。
  if (existsSync(dstPromptsDir)) {
    for (const existing of listFilesRecursive(dstPromptsDir)) {
      const relLower = relative(dstPromptsDir, existing).toLowerCase();
      if (!expectedRelLower.has(relLower)) {
        rmSync(existing, { force: true });
      }
    }
  }

  let copied = 0;
  for (const srcFile of srcFiles) {
    const rel = relative(srcPromptsDir, srcFile);
    const dstFile = join(dstPromptsDir, rel);
    mkdirSync(dirname(dstFile), { recursive: true });
    copyFileSync(srcFile, dstFile);
    if (sha256(srcFile) !== sha256(dstFile)) {
      throw new Error(`SHA-256 校验失败: prompts/${rel}`);
    }
    copied += 1;
  }
  return copied;
}

function tryReloadObsidian(vaultPath) {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "skipped (no LOCALAPPDATA)";
  const cli = join(localAppData, "Programs", "Obsidian", "Obsidian.com");
  if (!existsSync(cli)) return "skipped (Obsidian CLI not found)";
  const vaultName = basename(vaultPath);
  try {
    const info = execFileSync(cli, [`vault=${vaultName}`, "plugin", `id=${PLUGIN_ID}`], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (!/\benabled\s+true\b/i.test(info)) {
      return `skipped (plugin disabled in vault "${vaultName}")`;
    }
    execFileSync(cli, [`vault=${vaultName}`, "plugin:reload", `id=${PLUGIN_ID}`], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const errors = execFileSync(cli, [`vault=${vaultName}`, "dev:errors"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    return `reloaded (${errors || "no errors"})`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `skipped (${message.split(/\r?\n/)[0]})`;
  }
}

function main() {
  const { vaultPath, skipBuild, reload } = parseArgs(process.argv.slice(2));
  if (!vaultPath) {
    console.error("缺少目标笔记库路径：请传 --vault <path> 或设置环境变量 CR_OBSIDIAN_VAULT");
    process.exit(1);
  }
  const resolvedVault = resolve(vaultPath);
  if (!existsSync(resolvedVault) || !statSync(resolvedVault).isDirectory()) {
    console.error(`目标笔记库目录不存在: ${resolvedVault}`);
    process.exit(1);
  }
  const dstPluginDir = join(resolvedVault, ".obsidian", "plugins", PLUGIN_DIR_NAME);
  if (resolve(dstPluginDir).toLowerCase() === resolve(ROOT).toLowerCase()) {
    console.error("目标目录与源仓库相同，已中止同步");
    process.exit(1);
  }

  if (!skipBuild) {
    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
    execFileSync(npmCmd, ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  }

  mkdirSync(dstPluginDir, { recursive: true });
  const syncedSummary = [];
  for (const file of STATIC_FILES) {
    const srcFile = join(ROOT, file);
    const dstFile = join(dstPluginDir, file);
    if (!existsSync(srcFile)) {
      throw new Error(`源构建产物缺失: ${srcFile}`);
    }
    copyFileSync(srcFile, dstFile);
    const srcHash = sha256(srcFile);
    const dstHash = sha256(dstFile);
    if (srcHash !== dstHash) {
      throw new Error(`SHA-256 校验失败: ${file}`);
    }
    syncedSummary.push(`${file} (${statSync(dstFile).size}B, sha256=${dstHash.slice(0, 12)})`);
  }

  const promptCount = syncPrompts(join(ROOT, "prompts"), join(dstPluginDir, "prompts"));
  const reloadStatus = reload ? tryReloadObsidian(resolvedVault) : "skipped (--no-reload)";

  console.log(`已同步到: ${dstPluginDir}`);
  for (const line of syncedSummary) console.log(`  - ${line}`);
  console.log(`  - prompts/: ${promptCount} 个文件（SHA-256 全部一致）`);
  console.log(`  - Obsidian 重载: ${reloadStatus}`);
}

main();

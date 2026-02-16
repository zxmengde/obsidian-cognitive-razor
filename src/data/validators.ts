/** 数据验证函数 - 验证数据模型的完整性和正确性 */

import {
  CRFrontmatter,
  CRType,
  NoteState,
  TaskRecord,
  TaskType,
  TaskState,
  DuplicatePair,
  DuplicatePairStatus,
  Result,
  ok,
  err,
} from "../types";
import { formatCRTimestamp } from "../utils/date-utils";

// UUID 验证

/** UUID v4 正则表达式 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 验证 UUID v4 格式 */
export function isValidUUID(uid: string): boolean {
  return UUID_V4_REGEX.test(uid);
}

/**
 * 生成 UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ISO 8601 时间戳验证

/** 验证 CR 时间戳格式 yyyy-MM-DD HH:mm:ss */
export function isValidCRTimestamp(timestamp: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  if (!regex.test(timestamp)) {
    return false;
  }
  const date = new Date(timestamp.replace(" ", "T"));
  return !isNaN(date.getTime());
}

/**
 * 生成当前时间的 CR 时间戳
 */
export function generateTimestamp(): string {
  return formatCRTimestamp();
}

// CRFrontmatter 验证

/** 验证知识类型 */
export function isValidCRType(type: string): type is CRType {
  return ["Domain", "Issue", "Theory", "Entity", "Mechanism"].includes(type);
}

/**
 * 验证笔记状态
 */
export function isValidNoteState(state: string): state is NoteState {
  return ["Stub", "Draft", "Evergreen"].includes(state);
}

/** 验证 CRFrontmatter 数据完整性 */
export function validateCRFrontmatter(data: unknown): Result<CRFrontmatter> {
  if (!data || typeof data !== "object") {
    return err("INVALID_FRONTMATTER", "Frontmatter 必须是对象");
  }

  const fm = data as Partial<CRFrontmatter>;

  // 验证必填字段
  if (!fm.cruid || typeof fm.cruid !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: cruid");
  }

  if (!isValidUUID(fm.cruid)) {
    return err("INVALID_UUID", `无效的 UUID 格式: ${fm.cruid}`);
  }

  if (!fm.type || !isValidCRType(fm.type)) {
    return err("INVALID_TYPE", `无效的知识类型: ${fm.type}`);
  }

  if (!fm.name || typeof fm.name !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: name");
  }

  if (!fm.status || !isValidNoteState(fm.status)) {
    return err("INVALID_STATUS", `无效的笔记状态: ${fm.status}`);
  }

  if (!fm.created || typeof fm.created !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: created");
  }

  if (!isValidCRTimestamp(fm.created)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${fm.created}`);
  }

  if (!fm.updated || typeof fm.updated !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: updated");
  }

  if (!isValidCRTimestamp(fm.updated)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${fm.updated}`);
  }

  if (!Array.isArray(fm.parents)) {
    return err("MISSING_FIELD", "缺少必填字段: parents");
  }

  for (const parent of fm.parents) {
    if (typeof parent !== "string") {
      return err("INVALID_FIELD", "parents 必须是字符串数组");
    }
  }

  // 验证可选字段
  if (fm.aliases !== undefined && !Array.isArray(fm.aliases)) {
    return err("INVALID_FIELD", "aliases 必须是数组");
  }

  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    return err("INVALID_FIELD", "tags 必须是数组");
  }

  if (fm.sourceUids !== undefined) {
    if (!Array.isArray(fm.sourceUids)) {
      return err("INVALID_FIELD", "sourceUids 必须是数组");
    }
    for (const uid of fm.sourceUids) {
      if (!isValidUUID(uid)) {
        return err("INVALID_UUID", `无效的来源 UUID: ${uid}`);
      }
    }
  }

  return ok(fm as CRFrontmatter);
}

// TaskRecord 验证

/** 验证任务类型 */
export function isValidTaskType(type: string): type is TaskType {
  return [
    "define",
    "tag",
    "write",
    "amend",
    "merge",
    "index",
    "verify",
    "image-generate",
  ].includes(type);
}

/**
 * 验证任务状态
 */
export function isValidTaskState(state: string): state is TaskState {
  return ["Pending", "Running", "Completed", "Failed", "Cancelled"].includes(state);
}

/** 验证 TaskRecord 数据完整性 */
export function validateTaskRecord(data: unknown): Result<TaskRecord> {
  if (!data || typeof data !== "object") {
    return err("INVALID_TASK", "TaskRecord 必须是对象");
  }

  const task = data as Partial<TaskRecord>;

  // 验证必填字段
  if (!task.id || typeof task.id !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: id");
  }

  if (!task.taskType || !isValidTaskType(task.taskType)) {
    return err("INVALID_TYPE", `无效的任务类型: ${task.taskType}`);
  }

  if (!task.nodeId || typeof task.nodeId !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: nodeId");
  }

  if (!isValidUUID(task.nodeId) && task.taskType !== "image-generate") {
    return err("INVALID_UUID", `无效的节点 UUID: ${task.nodeId}`);
  }

  if (!task.state || !isValidTaskState(task.state)) {
    return err("INVALID_STATE", `无效的任务状态: ${task.state}`);
  }

  if (typeof task.attempt !== "number" || task.attempt < 0) {
    return err("INVALID_FIELD", "attempt 必须是非负整数");
  }

  if (typeof task.maxAttempts !== "number" || task.maxAttempts < 1) {
    return err("INVALID_FIELD", "maxAttempts 必须是正整数");
  }

  if (!task.payload || typeof task.payload !== "object") {
    return err("MISSING_FIELD", "缺少必填字段: payload");
  }

  if (!task.created || typeof task.created !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: created");
  }

  if (!isValidCRTimestamp(task.created)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.created}`);
  }

  if (!task.updated || typeof task.updated !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: updated");
  }

  if (!isValidCRTimestamp(task.updated)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.updated}`);
  }

  // 验证可选字段
  if (task.startedAt !== undefined && !isValidCRTimestamp(task.startedAt)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.startedAt}`);
  }

  if (task.completedAt !== undefined && !isValidCRTimestamp(task.completedAt)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.completedAt}`);
  }

  if (task.errors !== undefined && !Array.isArray(task.errors)) {
    return err("INVALID_FIELD", "errors 必须是数组");
  }

  return ok(task as TaskRecord);
}

// DuplicatePair 验证

/** 验证重复对状态 */
export function isValidDuplicatePairStatus(status: string): status is DuplicatePairStatus {
  return ["pending", "merging", "merged", "dismissed"].includes(status);
}

/** 验证 DuplicatePair 数据完整性 */
export function validateDuplicatePair(data: unknown): Result<DuplicatePair> {
  if (!data || typeof data !== "object") {
    return err("INVALID_DUPLICATE_PAIR", "DuplicatePair 必须是对象");
  }

  const pair = data as Partial<DuplicatePair>;

  // 验证必填字段
  if (!pair.id || typeof pair.id !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: id");
  }

  if (!pair.nodeIdA || typeof pair.nodeIdA !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: nodeIdA");
  }
  if (!isValidUUID(pair.nodeIdA)) {
    return err("INVALID_UUID", `无效的 nodeIdA: ${pair.nodeIdA}`);
  }

  if (!pair.nodeIdB || typeof pair.nodeIdB !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: nodeIdB");
  }
  if (!isValidUUID(pair.nodeIdB)) {
    return err("INVALID_UUID", `无效的 nodeIdB: ${pair.nodeIdB}`);
  }

  if (!pair.type || !isValidCRType(pair.type)) {
    return err("INVALID_TYPE", `无效的知识类型: ${pair.type}`);
  }

  if (typeof pair.similarity !== "number" || pair.similarity < 0 || pair.similarity > 1) {
    return err("INVALID_FIELD", "similarity 必须是 0-1 之间的数字");
  }

  if (!pair.detectedAt || typeof pair.detectedAt !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: detectedAt");
  }

  if (!isValidCRTimestamp(pair.detectedAt)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${pair.detectedAt}`);
  }

  if (!pair.status || !isValidDuplicatePairStatus(pair.status)) {
    return err("INVALID_STATUS", `无效的重复对状态: ${pair.status}`);
  }

  return ok(pair as DuplicatePair);
}

// URL 验证

/** 验证 URL 格式 */
export function validateUrl(url: string): string | null {
  // 检查是否为空
  if (!url || typeof url !== "string") {
    return "URL 不能为空";
  }

  // 去除首尾空格
  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0) {
    return "URL 不能为空";
  }

  // 必须以 http:// 或 https:// 开头
  if (!/^https?:\/\/.+/.test(trimmedUrl)) {
    return "URL 必须以 http:// 或 https:// 开头";
  }

  // 尝试解析 URL
  try {
    const parsedUrl = new URL(trimmedUrl);
    
    // 验证协议
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return "URL 必须使用 HTTP 或 HTTPS 协议";
    }

    // 验证主机名
    if (!parsedUrl.hostname || parsedUrl.hostname.length === 0) {
      return "URL 必须包含有效的主机名";
    }

    return null; // 有效
  } catch {
    return "无效的 URL 格式";
  }
}

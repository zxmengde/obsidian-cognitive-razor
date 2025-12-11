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

/** 验证 ISO 8601 时间戳格式 */
export function isValidISO8601(timestamp: string): boolean {
  const date = new Date(timestamp);
  return !isNaN(date.getTime()) && date.toISOString() === timestamp;
}

/**
 * 生成当前时间的 ISO 8601 时间戳
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
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
  if (!fm.crUid || typeof fm.crUid !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: crUid");
  }

  if (!isValidUUID(fm.crUid)) {
    return err("INVALID_UUID", `无效的 UUID 格式: ${fm.crUid}`);
  }

  if (!fm.type || !isValidCRType(fm.type)) {
    return err("INVALID_TYPE", `无效的知识类型: ${fm.type}`);
  }

  if (!fm.status || !isValidNoteState(fm.status)) {
    return err("INVALID_STATUS", `无效的笔记状态: ${fm.status}`);
  }

  if (!fm.created || typeof fm.created !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: created");
  }

  if (!isValidISO8601(fm.created)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${fm.created}`);
  }

  if (!fm.updated || typeof fm.updated !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: updated");
  }

  if (!isValidISO8601(fm.updated)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${fm.updated}`);
  }

  // 验证可选字段
  if (fm.aliases !== undefined && !Array.isArray(fm.aliases)) {
    return err("INVALID_FIELD", "aliases 必须是数组");
  }

  if (fm.tags !== undefined && !Array.isArray(fm.tags)) {
    return err("INVALID_FIELD", "tags 必须是数组");
  }

  if (fm.parentUid !== undefined && !isValidUUID(fm.parentUid)) {
    return err("INVALID_UUID", `无效的父概念 UUID: ${fm.parentUid}`);
  }

  if (fm.parentType !== undefined && !isValidCRType(fm.parentType)) {
    return err("INVALID_TYPE", `无效的父概念类型: ${fm.parentType}`);
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
    "embedding",
    "standardizeClassify",
    "enrich",
    "reason:new",
    "reason:incremental",
    "reason:merge",
    "ground",
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

  if (!task.nodeId || typeof task.nodeId !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: nodeId");
  }

  if (!isValidUUID(task.nodeId)) {
    return err("INVALID_UUID", `无效的节点 UUID: ${task.nodeId}`);
  }

  if (!task.taskType || !isValidTaskType(task.taskType)) {
    return err("INVALID_TYPE", `无效的任务类型: ${task.taskType}`);
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

  if (!isValidISO8601(task.created)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.created}`);
  }

  if (!task.updated || typeof task.updated !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: updated");
  }

  if (!isValidISO8601(task.updated)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.updated}`);
  }

  // 验证可选字段
  if (task.startedAt !== undefined && !isValidISO8601(task.startedAt)) {
    return err("INVALID_TIMESTAMP", `无效的时间戳格式: ${task.startedAt}`);
  }

  if (task.completedAt !== undefined && !isValidISO8601(task.completedAt)) {
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

  if (!pair.noteA || typeof pair.noteA !== "object") {
    return err("MISSING_FIELD", "缺少必填字段: noteA");
  }

  if (!pair.noteA.nodeId || !isValidUUID(pair.noteA.nodeId)) {
    return err("INVALID_UUID", `无效的 noteA.nodeId: ${pair.noteA.nodeId}`);
  }

  if (!pair.noteA.name || typeof pair.noteA.name !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: noteA.name");
  }

  if (!pair.noteA.path || typeof pair.noteA.path !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: noteA.path");
  }

  if (!pair.noteB || typeof pair.noteB !== "object") {
    return err("MISSING_FIELD", "缺少必填字段: noteB");
  }

  if (!pair.noteB.nodeId || !isValidUUID(pair.noteB.nodeId)) {
    return err("INVALID_UUID", `无效的 noteB.nodeId: ${pair.noteB.nodeId}`);
  }

  if (!pair.noteB.name || typeof pair.noteB.name !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: noteB.name");
  }

  if (!pair.noteB.path || typeof pair.noteB.path !== "string") {
    return err("MISSING_FIELD", "缺少必填字段: noteB.path");
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

  if (!isValidISO8601(pair.detectedAt)) {
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

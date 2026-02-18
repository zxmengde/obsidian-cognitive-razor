/**
 * Cognitive Razor 核心类型定义（Barrel Re-export）
 *
 * M-04 重构：原 ~1470 行单文件已拆分为 src/types/ 下的子模块。
 * 本文件保留为 barrel re-export，确保所有现有 import 路径不变。
 *
 * 子模块结构：
 *   domain.ts   — CRType, NoteState, CRFrontmatter, StandardizedConcept
 *   result.ts   — Result, Ok, Err, ok(), err(), CognitiveRazorError, toErr
 *   task.ts     — TaskType, TaskState, Payload/Result, TaskRecord
 *   provider.ts — Chat/Embed/Image 请求响应, DEFAULT_ENDPOINTS
 *   settings.ts — ProviderConfig, PluginSettings, DEFAULT_UI_STATE
 *   storage.ts  — Snapshot, DuplicatePair, VectorEntry, QueueStateFile
 *   pipeline.ts — PipelineStage, PipelineContext
 *   queue.ts    — QueueStatus, QueueEvent, TaskResult
 *   ui.ts       — ValidationContext/Result/Error
 *   logger.ts   — ILogger
 */

export * from "./types/index";

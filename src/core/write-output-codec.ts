import { err, ok } from "../types";
import type { CRType, Result, TaskModelSnapshot } from "../types";
import { getWriteStageDefinitions } from "./stage-catalog";
import { buildPhaseJsonSchema } from "./schema-registry";

/** 写作阶段共用 Schema，避免格式变化破坏缓存；Gemini 的隐式缓存由服务端默认启用。 */
export function usesStableWriteEnvelope(model: TaskModelSnapshot): boolean {
  return (model.providerSnapshot?.apiFormat === "gemini-generative-language" && model.model === "gemini-4-argon")
    || (model.providerSnapshot?.apiFormat === "openai-responses"
    && /^gpt-6(?![0-9])/.test(model.model));
}

/** One format per knowledge type preserves the same rendering across stages.
 * The API accepts any branch; the application still enforces the current stage. */
export function buildStableWriteSchema(type: CRType, fullSchema: object): object {
  const branches = getWriteStageDefinitions(type).map(stage => {
    const schema = buildPhaseJsonSchema(fullSchema, stage.fields);
    return { ...schema, properties: { stage: { type: "string", enum: [stage.id], description: "必须等于本轮 write_stage 指定的阶段。" }, ...schema.properties }, required: ["stage", ...stage.fields] };
  });
  return { type: "object", properties: { result: { anyOf: branches } }, required: ["result"], additionalProperties: false };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Shape and stage selection only. Call the original phase Validator on fields
 * before accepting either a new response or a prior turn for draft coverage. */
export function decodeWriteEnvelope(raw: string, type: CRType, expectedStage?: string): Result<{
  stageId: string; fields: Record<string, unknown>;
}> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    return err("E210_MODEL_OUTPUT_PARSE_FAILED", "模型未返回可解析的写作包裹 JSON");
  }
  if (!record(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, "result") || !record(value.result)
    || !Object.hasOwn(value.result, "stage") || typeof value.result.stage !== "string") {
    return err("E211_MODEL_SCHEMA_VIOLATION", "模型写作包裹结构不符合 Schema");
  }
  const stageId = value.result.stage;
  if (!getWriteStageDefinitions(type).some(stage => stage.id === stageId) || (expectedStage !== undefined && stageId !== expectedStage)) {
    return err("E211_MODEL_SCHEMA_VIOLATION", "模型返回的写作阶段与当前任务不一致；结果未提交，未自动重发");
  }
  const { stage: _stage, ...fields } = value.result;
  return ok({ stageId, fields });
}

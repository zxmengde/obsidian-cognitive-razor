import { describe, expect, it } from "vitest";
import { ok } from "../types";
import { Validator } from "../data/validator";
import { ResponsePipeline } from "./response-pipeline";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: { name: { type: "string", minLength: 1 } },
};

describe("ResponsePipeline", () => {
  it("validates JSON and schema through one result contract", async () => {
    const pipeline = new ResponsePipeline(new Validator());

    await expect(pipeline.validate({ taskId: "task-1", rawOutput: '{"name":"ok"}', schema }))
      .resolves.toEqual(ok({ name: "ok" }));
    await expect(pipeline.validate({ taskId: "task-1", rawOutput: '{"other":true}', schema }))
      .resolves.toMatchObject({ ok: false, error: { code: "E211_MODEL_SCHEMA_VIOLATION", details: { taskId: "task-1" } } });
  });

  it("fails invalid JSON locally without an additional model pass", async () => {
    const pipeline = new ResponsePipeline(new Validator());

    await expect(pipeline.validate({
      taskId: "task-1",
      rawOutput: "not-json",
      schema,
    })).resolves.toMatchObject({ ok: false, error: { code: "E210_MODEL_OUTPUT_PARSE_FAILED" } });
  });

  it("centralizes finish-reason safety errors", () => {
    const pipeline = new ResponsePipeline(new Validator());

    expect(pipeline.checkFinishReason("task-1", { content: "", finishReason: "length" }))
      .toMatchObject({ ok: false, error: { code: "E214_MODEL_OUTPUT_TRUNCATED", details: { taskId: "task-1" } } });
    expect(pipeline.checkFinishReason("task-1", { content: "ok", finishReason: "stop" })).toBeNull();
  });
});

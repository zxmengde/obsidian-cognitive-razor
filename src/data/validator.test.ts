import { describe, expect, it } from "vitest";
import { Validator } from "./validator";

describe("Validator", () => {
  it("permits explicitly empty required strings without allowing missing or mistyped fields", async () => {
    const validator = new Validator();
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string", minLength: 0 } } };
    expect((await validator.validate('{"name":""}', schema)).valid).toBe(true);
    expect((await validator.validate('{}', schema)).valid).toBe(false);
    expect((await validator.validate('{"name":null}', schema)).valid).toBe(false);
    expect((await validator.validate('{"name":12}', schema)).valid).toBe(false);
  });

  it("reports parse errors for non-JSON output", async () => {
    const validator = new Validator();
    const result = await validator.validate("not json", {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.[0].code).toBe("E210_MODEL_OUTPUT_PARSE_FAILED");
  });

  it("validates nested required fields, enum, min/max and additionalProperties", async () => {
    const validator = new Validator();
    const schema = {
      type: "object",
      required: ["items", "status", "score"],
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          minItems: 1,
          maxItems: 1,
          items: {
            type: "object",
            required: ["name"],
            additionalProperties: false,
            properties: {
              name: { type: "string" },
            },
          },
        },
        status: { type: "string", enum: ["draft", "final"] },
        score: { type: "number", minimum: 0, maximum: 1 },
      },
    };

    const result = await validator.validate(
      JSON.stringify({
        items: [{ extra: true }],
        status: "unknown",
        score: 2,
        unexpected: true,
      }),
      schema,
    );

    expect(result.valid).toBe(false);
    const locations = result.errors?.map((error) => error.location) ?? [];
    expect(locations).toContain("/items/0/name");
    expect(locations).toContain("/items/0/extra");
    expect(locations).toContain("/status");
    expect(locations).toContain("/score");
    expect(locations).toContain("/unexpected");
  });

  it("keeps required string fields non-empty", async () => {
    const validator = new Validator();
    const result = await validator.validate(
      JSON.stringify({ name: "   " }),
      {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors?.[0].location).toBe("/name");
  });

  it("解析多个代码块时会跳过非 JSON 代码块并使用后续 JSON", async () => {
    const validator = new Validator();
    const result = await validator.validate(
      [
        "先给出一个示例：",
        "```text",
        "not json",
        "```",
        "再给出最终结果：",
        "```",
        "{\"name\":\"有效结果\"}",
        "```",
      ].join("\n"),
      {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
        },
      },
    );

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: "有效结果" });
  });
});

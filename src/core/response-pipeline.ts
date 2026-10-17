import { err, ok } from "../types";
import type {
  ChatResponse,
  Result,
  ValidationResult,
} from "../types";
import type { Validator } from "../data/validator";
import { validateChatFinishReason } from "./provider-response-parsers";

export interface ResponseValidationRequest {
  taskId: string;
  rawOutput: string;
  schema: object;
}

/** Single owner for finish-reason and local schema validation. */
export class ResponsePipeline {
  constructor(private readonly validator: Pick<Validator, "validate">) {}

  checkFinishReason<T = Record<string, unknown>>(
    taskId: string,
    response: ChatResponse,
  ): Result<T> | null {
    const validation = validateChatFinishReason(response.finishReason, { taskId });
    return validation.ok ? null : validation as Result<T>;
  }

  async validate<T = Record<string, unknown>>(
    request: ResponseValidationRequest,
  ): Promise<Result<T>> {
    const initial = await this.validator.validate(request.rawOutput, request.schema);
    if (initial.valid) return ok(initial.data as T);
    return this.validationError<T>(request.taskId, initial);
  }

  private validationError<T>(taskId: string, result: Extract<ValidationResult, { valid: false }>): Result<T> {
    const firstError = result.errors[0] ?? {
      code: "E211_MODEL_SCHEMA_VIOLATION",
      message: "模型输出不符合 Schema",
    };
    return err(firstError.code, firstError.message, {
      taskId,
      validationErrors: result.errors,
    });
  }
}

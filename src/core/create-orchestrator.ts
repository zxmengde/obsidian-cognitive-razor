import { buildTaskChatRequest } from "./task-execution-support";
/**
 * Create workflow entry points.
 *
 * Define is intentionally immediate so the workbench can ask the user to
 * confirm a normalized concept. Once confirmed, all durable work belongs to
 * WorkflowCoordinator; this class does not keep a second in-memory pipeline.
 */

import {
    type ChatResponse,
    type ILogger,
    type ConfirmedConcept,
    type DefinePreview,
    type Result,
    err,
    ok,
    toErr,
} from "../types";
import type { SettingsStore } from "../data/settings-store";
import type { PromptManager } from "./prompt-manager";
import type { ModelGateway } from "./model-gateway";
import type { SchemaRegistry, JSONSchema } from "./schema-registry";
import type { Validator } from "../data/validator";
import type { WorkflowCoordinator } from "./workflow-coordinator";
import { mapDefineOutput } from "./define-preview-mapper";
import { resolveTaskModelSnapshot } from "./task-model-resolver";
import { validateChatFinishReason } from "./provider-response-parsers";
import { validatePrerequisites } from "./orchestrator-utils";

function validateDefineInput(userInput: string): Result<string> {
    if (typeof userInput !== "string" || userInput.trim().length === 0) {
        return err("E101_INVALID_INPUT", "输入不能为空");
    }
    if (userInput.length > 10_000) {
        return err("E101_INVALID_INPUT", "输入过长，请缩短后重试（最大 10000 字符）");
    }
    const sanitized = Array.from(userInput)
        .map((char) => /[\s\p{Cc}]/u.test(char) ? " " : char)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
    return sanitized ? ok(sanitized) : err("E101_INVALID_INPUT", "输入不能为空");
}

function linkAbortSignals(
    lifecycleSignal: AbortSignal,
    callerSignal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
    if (!callerSignal) return { signal: lifecycleSignal, dispose: () => undefined };

    const controller = new AbortController();
    const sources = [lifecycleSignal, callerSignal];
    const listeners = sources.map((source) => {
        const listener = () => {
            if (!controller.signal.aborted) controller.abort(source.reason);
        };
        source.addEventListener("abort", listener, { once: true });
        if (source.aborted) listener();
        return { source, listener };
    });

    return {
        signal: controller.signal,
        dispose: () => listeners.forEach(({ source, listener }) => source.removeEventListener("abort", listener)),
    };
}

interface CreateOrchestratorDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    promptManager: PromptManager;
    providerManager: ModelGateway;
    schemaRegistry: SchemaRegistry;
    validator: Validator;
    workflowCoordinator: WorkflowCoordinator;
}

/** Options that affect the target note, not the confirmed concept fact. */
export interface CreateWorkflowOptions {
    targetPathOverride?: string;
}

export class CreateOrchestrator {
    private disposed = false;
    private readonly lifecycleAbort = new AbortController();
    private readonly activeOperations = new Set<Promise<unknown>>();
    private disposePromise?: Promise<void>;

    constructor(private readonly deps: CreateOrchestratorDeps) {
        this.deps.logger.debug("CreateOrchestrator", "创建工作流入口已初始化");
    }

    /** Immediate Define preview. It never creates a queue record. */
    async defineDirect(userInput: string, signal?: AbortSignal): Promise<Result<DefinePreview>> {
        if (this.disposed) return err("E310_INVALID_STATE", "创建服务已停止");
        const linkedAbort = linkAbortSignals(this.lifecycleAbort.signal, signal);
        const operation = this.defineDirectInternal(userInput, linkedAbort.signal).finally(linkedAbort.dispose);
        return this.track(operation);
    }

    /** Start the durable Create workflow after the user confirms a concept. */
    async confirmCreate(
        concept: ConfirmedConcept,
        options?: CreateWorkflowOptions,
    ): Promise<Result<string>> {
        if (this.disposed) return err("E310_INVALID_STATE", "创建服务已停止");
        const operation = this.startCreate(concept, options);
        return this.track(operation);
    }

    isPathActive(filePath: string): boolean {
        return this.deps.workflowCoordinator.isPathActive(filePath);
    }

    async dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        if (!this.lifecycleAbort.signal.aborted) {
            this.lifecycleAbort.abort(new Error("CreateOrchestrator disposed"));
        }
        this.disposePromise = Promise.all([...this.activeOperations].map((operation) => operation.catch(() => undefined)))
            .then(() => {
                this.activeOperations.clear();
            });
        return this.disposePromise;
    }

    private async startCreate(
        concept: ConfirmedConcept,
        options?: CreateWorkflowOptions,
    ): Promise<Result<string>> {
        const prerequisite = validatePrerequisites(
            this.deps.settingsStore.getSettings(),
            "tag",
            this.deps.promptManager,
            this.deps.logger,
            "CreateOrchestrator",
        );
        if (!prerequisite.ok) return prerequisite as Result<string>;
        if (this.disposed) return err("E310_INVALID_STATE", "创建服务已停止");
        return this.deps.workflowCoordinator.startCreate(concept, options);
    }

    private async defineDirectInternal(
        userInput: string,
        signal: AbortSignal,
    ): Promise<Result<DefinePreview>> {
        try {
            if (signal.aborted) return err("E310_INVALID_STATE", "操作已取消", signal.reason);
            const prerequisite = validatePrerequisites(
                this.deps.settingsStore.getSettings(),
                "define",
                this.deps.promptManager,
                this.deps.logger,
                "CreateOrchestrator",
            );
            if (!prerequisite.ok) return prerequisite as Result<DefinePreview>;

            const inputResult = validateDefineInput(userInput);
            if (!inputResult.ok) return inputResult;
            const promptResult = this.buildDefinePrompt(inputResult.value);
            if (!promptResult.ok) return promptResult as Result<DefinePreview>;
            const model = resolveTaskModelSnapshot(this.deps.settingsStore.getSettings(), "define");
            const response = await this.deps.providerManager.chat(
                buildTaskChatRequest("define", promptResult.value.prompt, model, promptResult.value.schema, "define"), signal);
            if (signal.aborted) return err("E310_INVALID_STATE", "操作已取消", signal.reason);
            if (!response.ok) {
                this.deps.logger.error("CreateOrchestrator", "Define API 调用失败", undefined, {
                    errorCode: response.error.code,
                    errorMessage: response.error.message,
                    event: "DEFINE_DIRECT_ERROR",
                });
                return err(response.error.code, response.error.message);
            }
            return this.parseDefineResponse(response.value, promptResult.value.schema, signal);
        } catch (error) {
            if (signal.aborted) return err("E310_INVALID_STATE", "操作已取消", signal.reason);
            this.deps.logger.error("CreateOrchestrator", "Define 失败", error as Error);
            return err("E500_INTERNAL_ERROR", "Define 失败", error);
        }
    }

    private buildDefinePrompt(input: string): Result<{ prompt: string; schema: JSONSchema }> {
        try {
            return ok({
                prompt: this.deps.promptManager.build("define", { CTX_INPUT: input }),
                schema: this.deps.schemaRegistry.getDefineSchema(),
            });
        } catch (error) {
            this.deps.logger.error("CreateOrchestrator", "构建 Define 提示词失败", error as Error, {
                event: "DEFINE_DIRECT_ERROR",
            });
            return toErr(error, "E500_INTERNAL_ERROR", "构建 Define 提示词失败");
        }
    }

    private async parseDefineResponse(
        response: ChatResponse,
        schema: JSONSchema,
        signal: AbortSignal,
    ): Promise<Result<DefinePreview>> {
        const finish = validateChatFinishReason(response.finishReason);
        if (!finish.ok) return finish;
        try {
            const validation = await this.deps.validator.validate(response.content, schema);
            if (!validation.valid) {
                const firstError = validation.errors[0];
                this.deps.logger.error("CreateOrchestrator", "Define 结果不符合 Schema", undefined, {
                    errorCode: firstError?.code ?? "E211_MODEL_SCHEMA_VIOLATION",
                    event: "DEFINE_DIRECT_SCHEMA_ERROR",
                    validationErrors: validation.errors.map(({ code, type, location }) => ({ code, type, location })),
                });
                return err(
                    firstError?.code ?? "E211_MODEL_SCHEMA_VIOLATION",
                    firstError?.message ?? "Define 结果不符合 Schema",
                    { errors: validation.errors },
                );
            }
            if (signal.aborted) return err("E310_INVALID_STATE", "操作已取消", signal.reason);
            const parsed = mapDefineOutput(validation.data);
            this.deps.logger.info("CreateOrchestrator", "Define 预览完成", {
                event: "DEFINE_DIRECT_SUCCESS",
            });
            return ok(parsed);
        } catch (error) {
            this.deps.logger.error("CreateOrchestrator", "解析 Define 结果失败", error as Error, {
                event: "DEFINE_DIRECT_PARSE_ERROR",
            });
            return err("E210_MODEL_OUTPUT_PARSE_FAILED", "解析 Define 结果失败", error);
        }
    }

    private track<T>(operation: Promise<T>): Promise<T> {
        this.activeOperations.add(operation);
        operation.then(
            () => this.activeOperations.delete(operation),
            () => this.activeOperations.delete(operation),
        );
        return operation;
    }
}

/** Durable Verify workflow entry point. */

import { type ILogger, type Result, err } from "../types";
import type { SettingsStore } from "../data/settings-store";
import type { PromptManager } from "./prompt-manager";
import type { WorkflowCoordinator } from "./workflow-coordinator";
import { validatePrerequisites } from "./orchestrator-utils";

interface VerifyOrchestratorDeps {
    settingsStore: SettingsStore;
    logger: ILogger;
    promptManager: PromptManager;
    workflowCoordinator: WorkflowCoordinator;
}

export class VerifyOrchestrator {
    private disposed = false;
    private readonly activeOperations = new Set<Promise<unknown>>();
    private disposePromise?: Promise<void>;

    constructor(private readonly deps: VerifyOrchestratorDeps) {
        this.deps.logger.debug("VerifyOrchestrator", "核查工作流入口已初始化");
    }

    startVerifyPipeline(filePath: string): Promise<Result<string>> {
        if (this.disposed) return Promise.resolve(err("E310_INVALID_STATE", "核查服务已停止"));
        return this.track(this.startVerify(filePath));
    }

    async dispose(): Promise<void> {
        if (this.disposePromise) return this.disposePromise;
        this.disposed = true;
        this.disposePromise = Promise.all([...this.activeOperations].map((operation) => operation.catch(() => undefined)))
            .then(() => {
                this.activeOperations.clear();
            });
        return this.disposePromise;
    }

    private async startVerify(filePath: string): Promise<Result<string>> {
        const prerequisite = validatePrerequisites(
            this.deps.settingsStore.getSettings(),
            "verify",
            this.deps.promptManager,
            this.deps.logger,
            "VerifyOrchestrator",
        );
        if (!prerequisite.ok) return prerequisite as Result<string>;
        if (this.disposed) return err("E310_INVALID_STATE", "核查服务已停止");
        return this.deps.workflowCoordinator.startVerify(filePath);
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

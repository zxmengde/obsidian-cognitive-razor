import type { TaskType } from "../../types";
import type { ProviderProbeReadModel } from "../provider-probe-result";
import type { TaskParameterKey } from "../task-parameter-summary";

/**
 * 任务页里尚未写入设置的输入。选了「指定」却还没有有效值时只留在这里，
 * 不往设置里写占位值（嵌入维度写 1 会清空向量，maxTokens 写 1 会截断输出）。
 */
export interface TaskDraft {
  pendingModel: boolean;
  modelDraft?: string;
  modelError: string;
  pendingSetKeys: TaskParameterKey[];
  draftValues: Partial<Record<TaskParameterKey, string>>;
  parameterErrors: Partial<Record<TaskParameterKey, string>>;
}

export interface TaskProbeRecord {
  /** 发起测试时的任务解析结果签名；配置变化后旧结果作废。 */
  signature: string;
  controller?: AbortController;
  result?: ProviderProbeReadModel;
}

function emptyDraft(): TaskDraft {
  return { pendingModel: false, modelError: "", pendingSetKeys: [], draftValues: {}, parameterErrors: {} };
}

/**
 * 一次设置会话内的任务页状态。原生设置页每次刷新都会重建行，
 * 草稿与进行中的探针放在这里才能跨刷新、跨页面导航保留；关闭设置页时清空。
 */
export class TaskPageState {
  private readonly drafts = new Map<TaskType, TaskDraft>();
  private readonly probes = new Map<TaskType, TaskProbeRecord>();

  draft(taskType: TaskType): TaskDraft {
    let draft = this.drafts.get(taskType);
    if (!draft) {
      draft = emptyDraft();
      this.drafts.set(taskType, draft);
    }
    return draft;
  }

  clearParameter(taskType: TaskType, key: TaskParameterKey): void {
    const draft = this.draft(taskType);
    draft.pendingSetKeys = draft.pendingSetKeys.filter((pending) => pending !== key);
    delete draft.draftValues[key];
    delete draft.parameterErrors[key];
  }

  resetDraft(taskType: TaskType): void {
    this.drafts.set(taskType, emptyDraft());
  }

  /** 读取探针记录；任务配置已变化的旧记录在这里作废并中止。 */
  probe(taskType: TaskType, signature: string): TaskProbeRecord | undefined {
    const record = this.probes.get(taskType);
    if (record && record.signature !== signature) {
      record.controller?.abort("task configuration changed");
      this.probes.delete(taskType);
      return undefined;
    }
    return record;
  }

  setProbe(taskType: TaskType, record: TaskProbeRecord): void {
    this.probes.get(taskType)?.controller?.abort("task probe replaced");
    this.probes.set(taskType, record);
  }

  isCurrentProbe(taskType: TaskType, record: TaskProbeRecord): boolean {
    return this.probes.get(taskType) === record;
  }

  clear(): void {
    for (const record of this.probes.values()) record.controller?.abort("settings closed");
    this.probes.clear();
    this.drafts.clear();
  }
}

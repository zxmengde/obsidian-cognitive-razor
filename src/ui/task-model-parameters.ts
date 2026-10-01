/**
 * 任务级参数（temperature、maxTokens、embeddingDimension 等）的三态覆盖逻辑。
 *
 * 三态含义：
 * - inherit：跟随 Provider 参数，不写入任务级覆盖
 * - set：写入一个具体的任务级值
 * - omit：写入 null，表示显式不发送该参数
 *
 * 关键约束：没有真实值可写入时绝不能编造一个占位数字。设置嵌入维度为 1 会
 * 立刻重置整个向量索引，maxTokens=1 会让下一次任务输出被截断。
 */

export type TaskParameterMode = "inherit" | "set" | "omit";

export interface TaskParameterInputs {
  /** 任务级覆盖对象中是否存在该键：存在且为 null 表示显式不发送。 */
  hasOverride: boolean;
  /** 任务级覆盖值。 */
  override?: unknown;
  /** 旧版任务字段，语义与 override 相同。 */
  legacy?: unknown;
  /** Provider 级默认参数值。 */
  provider?: unknown;
}

export type TaskParameterWrite =
  | { action: "delete" }
  | { action: "omit" }
  | { action: "set"; value: unknown }
  /** 没有真实值：只能先在界面上展开输入框，等用户输入后再持久化。 */
  | { action: "pending" };

/** 当前存储状态对应的显示模式。 */
export function storedParameterMode(inputs: TaskParameterInputs): TaskParameterMode {
  if (inputs.hasOverride) return inputs.override === null ? "omit" : "set";
  return inputs.legacy !== undefined ? "set" : "inherit";
}

/** 首个真实值；null（显式不发送）与 undefined 都不算真实值。 */
export function resolveParameterValue(inputs: TaskParameterInputs): unknown {
  if (inputs.override !== undefined && inputs.override !== null) return inputs.override;
  if (inputs.legacy !== undefined) return inputs.legacy;
  return inputs.provider;
}

/** 把用户在界面上选择的模式转换为要持久化的参数变更。 */
export function resolveParameterWrite(
  mode: TaskParameterMode,
  inputs: TaskParameterInputs,
): TaskParameterWrite {
  if (mode === "inherit") return { action: "delete" };
  if (mode === "omit") return { action: "omit" };
  const value = resolveParameterValue(inputs);
  return value === undefined ? { action: "pending" } : { action: "set", value };
}

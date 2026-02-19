/**
 * P4: TaskRecord 序列化往返一致性 + TaskFactory 单元测试
 *
 * 验证目标：TaskFactory 创建的任务经 JSON 序列化/反序列化后等价，
 * 且 validateTaskRecordPayload 能正确校验
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { TaskFactory, type CreateQueueTaskParams } from "./task-factory";
import { validateTaskRecordPayload } from "./task-queue";
import type { TaskType, CRType } from "../types";

const taskTypeArb = fc.constantFrom<TaskType>(
    "define", "tag", "write", "index", "verify"
);
const crTypeArb = fc.constantFrom<CRType>("Domain", "Issue", "Theory", "Entity", "Mechanism");
const nodeIdArb = fc.uuid();
const safeStringArb = fc.string({ minLength: 1, maxLength: 50 });

/**
 * 根据 taskType 生成对应的合法 payload
 */
function payloadArbForType(taskType: TaskType): fc.Arbitrary<Record<string, unknown>> {
    switch (taskType) {
        case "define":
            return safeStringArb.map((userInput) => ({ userInput }));
        case "tag":
            return fc.tuple(safeStringArb, crTypeArb).map(([userInput, conceptType]) => ({
                userInput,
                conceptType,
            }));
        case "write":
            return crTypeArb.map((conceptType) => ({ conceptType }));
        case "index":
            return fc.constant({});
        case "verify":
            return safeStringArb.map((currentContent) => ({ currentContent }));
    }
}

describe("TaskFactory", () => {
    describe("基础功能", () => {
        it("create 生成正确的任务结构", () => {
            const task = TaskFactory.create({
                nodeId: "node-001",
                taskType: "define",
                payload: { userInput: "量子力学" },
                maxAttempts: 3,
            });
            expect(task.nodeId).toBe("node-001");
            expect(task.taskType).toBe("define");
            expect(task.state).toBe("Pending");
            expect(task.attempt).toBe(0);
            expect(task.maxAttempts).toBe(3);
            expect(task.payload).toEqual({ userInput: "量子力学" });
        });

        it("create 支持可选字段", () => {
            const task = TaskFactory.create({
                nodeId: "node-002",
                taskType: "write",
                payload: { conceptType: "Entity" },
                maxAttempts: 1,
                providerRef: "openai",
                promptRef: "write-entity",
                typeLockKey: "type:Entity",
            });
            expect(task.providerRef).toBe("openai");
            expect(task.promptRef).toBe("write-entity");
            expect(task.typeLockKey).toBe("type:Entity");
        });
    });

    describe("validateTaskRecordPayload", () => {
        it("合法 payload 通过校验", () => {
            expect(validateTaskRecordPayload("define", { userInput: "test" })).toBeNull();
            expect(validateTaskRecordPayload("tag", { userInput: "test", conceptType: "Entity" })).toBeNull();
            expect(validateTaskRecordPayload("write", { conceptType: "Domain" })).toBeNull();
            expect(validateTaskRecordPayload("index", {})).toBeNull();
        });

        it("未知 taskType 返回错误", () => {
            expect(validateTaskRecordPayload("unknown", {})).toContain("未知的 taskType");
        });

        it("非对象 payload 返回错误", () => {
            expect(validateTaskRecordPayload("define", null)).toContain("不是有效对象");
            expect(validateTaskRecordPayload("define", "string")).toContain("不是有效对象");
            expect(validateTaskRecordPayload("define", [])).toContain("不是有效对象");
        });

        it("缺少必填字段返回错误", () => {
            expect(validateTaskRecordPayload("define", {})).toContain("缺少必填字段");
            expect(validateTaskRecordPayload("tag", { userInput: "test" })).toContain("缺少必填字段");
        });

        it("字段类型错误返回错误", () => {
            expect(validateTaskRecordPayload("define", { userInput: 123 })).toContain("类型错误");
        });
    });

    describe("P4: TaskRecord 序列化往返一致性（PBT）", () => {
        it("TaskFactory.create 的输出经 JSON 序列化/反序列化后等价", () => {
            fc.assert(
                fc.property(
                    taskTypeArb.chain((tt) =>
                        fc.tuple(
                            fc.constant(tt),
                            nodeIdArb,
                            payloadArbForType(tt),
                            fc.integer({ min: 1, max: 5 })
                        )
                    ),
                    ([taskType, nodeId, payload, maxAttempts]) => {
                        const task = TaskFactory.create({
                            nodeId,
                            taskType,
                            payload: payload as never,
                            maxAttempts,
                        });

                        // 序列化 → 反序列化
                        const serialized = JSON.stringify(task);
                        const deserialized = JSON.parse(serialized);

                        // 结构等价
                        expect(deserialized).toEqual(task);

                        // payload 校验通过
                        const validationError = validateTaskRecordPayload(
                            deserialized.taskType,
                            deserialized.payload
                        );
                        expect(validationError).toBeNull();
                    }
                ),
                { numRuns: 300 }
            );
        });

        it("反序列化后的 payload 仍能通过 validateTaskRecordPayload", () => {
            fc.assert(
                fc.property(
                    taskTypeArb.chain((tt) =>
                        fc.tuple(fc.constant(tt), payloadArbForType(tt))
                    ),
                    ([taskType, payload]) => {
                        const serialized = JSON.stringify(payload);
                        const deserialized = JSON.parse(serialized);
                        expect(validateTaskRecordPayload(taskType, deserialized)).toBeNull();
                    }
                ),
                { numRuns: 200 }
            );
        });
    });
});

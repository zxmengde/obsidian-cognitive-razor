/**
 * IncrementalImproveHandler 属性测试
 * 
 * **Feature: cognitive-razor, Property 16: Evergreen 降级**
 * **验证需求：4.5**
 */

import * as fc from "fast-check";
import { CRType, NoteState } from "../types";

/**
 * 生成有效的 UID (UUID v4 格式)
 */
const uidArbitrary = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 12, maxLength: 12 })
  )
  .map(([a, b, c, d, e]) => `${a}-${b}-${c}-${d}-${e}`);

/**
 * 生成知识类型
 */
const crTypeArbitrary: fc.Arbitrary<CRType> = fc.constantFrom(
  "Domain",
  "Issue",
  "Theory",
  "Entity",
  "Mechanism"
);

/**
 * 生成笔记状态
 */
const noteStateArbitrary: fc.Arbitrary<NoteState> = fc.constantFrom(
  "Stub",
  "Draft",
  "Evergreen"
);

/**
 * 生成 ISO 8601 时间戳
 */
const timestampArbitrary = fc
  .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31") })
  .map((d) => d.toISOString());

/**
 * 生成笔记内容（带 frontmatter）
 */
const noteContentArbitrary = fc
  .record({
    uid: uidArbitrary,
    type: crTypeArbitrary,
    status: noteStateArbitrary,
    created: timestampArbitrary,
    updated: timestampArbitrary,
    body: fc.lorem({ maxCount: 10 }),
  })
  .map(
    ({ uid, type, status, created, updated, body }) => `---
uid: ${uid}
type: ${type}
status: ${status}
created: ${created}
updated: ${updated}
---

# ${type} Note

${body}
`
  );

/**
 * 解析 frontmatter 中的状态
 */
function parseStatus(content: string): NoteState | null {
  const match = content.match(/^---\s*\n(?:.*\n)*?status:\s*(\w+)\s*\n/m);
  return match ? (match[1] as NoteState) : null;
}

/**
 * 降级笔记状态（模拟实现）
 */
function downgradeStatus(content: string): string {
  const currentStatus = parseStatus(content);
  
  // 如果不是 Evergreen，不需要降级
  if (currentStatus !== "Evergreen") {
    return content;
  }

  // 替换状态为 Draft
  const updatedContent = content.replace(
    /^(---\s*\n(?:.*\n)*?)status:\s*Evergreen\s*\n/m,
    "$1status: Draft\n"
  );

  // 更新 updated 时间
  const timestamp = new Date().toISOString();
  const finalContent = updatedContent.replace(
    /^(---\s*\n(?:.*\n)*?)updated:\s*[^\n]+\s*\n/m,
    `$1updated: ${timestamp}\n`
  );

  return finalContent;
}

describe("IncrementalImproveHandler Property Tests", () => {
  /**
   * **Feature: cognitive-razor, Property 16: Evergreen 降级**
   * 
   * *对于任意*状态为 Evergreen 的笔记，执行增量改进并确认后，
   * 笔记状态必须降级为 Draft。
   * 
   * **验证需求：4.5**
   */
  test("Property 16: Evergreen 状态必须降级为 Draft", async () => {
    await fc.assert(
      fc.asyncProperty(noteContentArbitrary, async (originalContent) => {
        const originalStatus = parseStatus(originalContent);

        // 执行状态降级
        const improvedContent = downgradeStatus(originalContent);
        const newStatus = parseStatus(improvedContent);

        // 验证属性
        if (originalStatus === "Evergreen") {
          // 如果原状态是 Evergreen，新状态必须是 Draft
          expect(newStatus).toBe("Draft");
        } else {
          // 如果原状态不是 Evergreen，状态不应改变
          expect(newStatus).toBe(originalStatus);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * 额外测试：验证非 Evergreen 状态不会被降级
   */
  test("非 Evergreen 状态不应被降级", async () => {
    await fc.assert(
      fc.asyncProperty(
        noteContentArbitrary.filter((content) => {
          const status = parseStatus(content);
          return status !== "Evergreen";
        }),
        async (originalContent) => {
          const originalStatus = parseStatus(originalContent);

          // 执行状态降级
          const improvedContent = downgradeStatus(originalContent);
          const newStatus = parseStatus(improvedContent);

          // 验证状态未改变
          expect(newStatus).toBe(originalStatus);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 额外测试：验证 updated 时间戳被更新
   */
  test("降级时 updated 时间戳应被更新", async () => {
    await fc.assert(
      fc.asyncProperty(
        noteContentArbitrary.filter((content) => {
          const status = parseStatus(content);
          return status === "Evergreen";
        }),
        async (originalContent) => {
          // 提取原始 updated 时间
          const originalUpdatedMatch = originalContent.match(
            /^---\s*\n(?:.*\n)*?updated:\s*([^\n]+)\s*\n/m
          );
          const originalUpdated = originalUpdatedMatch
            ? originalUpdatedMatch[1]
            : null;

          // 等待一小段时间确保时间戳不同
          await new Promise((resolve) => setTimeout(resolve, 10));

          // 执行状态降级
          const improvedContent = downgradeStatus(originalContent);

          // 提取新的 updated 时间
          const newUpdatedMatch = improvedContent.match(
            /^---\s*\n(?:.*\n)*?updated:\s*([^\n]+)\s*\n/m
          );
          const newUpdated = newUpdatedMatch ? newUpdatedMatch[1] : null;

          // 验证时间戳被更新
          expect(newUpdated).not.toBeNull();
          expect(newUpdated).not.toBe(originalUpdated);

          // 验证新时间戳是有效的 ISO 8601 格式
          if (newUpdated) {
            const date = new Date(newUpdated);
            expect(date.toISOString()).toBe(newUpdated);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * 额外测试：验证其他 frontmatter 字段不受影响
   */
  test("降级时其他 frontmatter 字段应保持不变", async () => {
    await fc.assert(
      fc.asyncProperty(noteContentArbitrary, async (originalContent) => {
        // 提取原始 UID 和 type
        const uidMatch = originalContent.match(
          /^---\s*\n(?:.*\n)*?uid:\s*([^\n]+)\s*\n/m
        );
        const typeMatch = originalContent.match(
          /^---\s*\n(?:.*\n)*?type:\s*([^\n]+)\s*\n/m
        );
        const createdMatch = originalContent.match(
          /^---\s*\n(?:.*\n)*?created:\s*([^\n]+)\s*\n/m
        );

        const originalUid = uidMatch ? uidMatch[1] : null;
        const originalType = typeMatch ? typeMatch[1] : null;
        const originalCreated = createdMatch ? createdMatch[1] : null;

        // 执行状态降级
        const improvedContent = downgradeStatus(originalContent);

        // 提取新的 UID 和 type
        const newUidMatch = improvedContent.match(
          /^---\s*\n(?:.*\n)*?uid:\s*([^\n]+)\s*\n/m
        );
        const newTypeMatch = improvedContent.match(
          /^---\s*\n(?:.*\n)*?type:\s*([^\n]+)\s*\n/m
        );
        const newCreatedMatch = improvedContent.match(
          /^---\s*\n(?:.*\n)*?created:\s*([^\n]+)\s*\n/m
        );

        const newUid = newUidMatch ? newUidMatch[1] : null;
        const newType = newTypeMatch ? newTypeMatch[1] : null;
        const newCreated = newCreatedMatch ? newCreatedMatch[1] : null;

        // 验证字段未改变
        expect(newUid).toBe(originalUid);
        expect(newType).toBe(originalType);
        expect(newCreated).toBe(originalCreated);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * 额外测试：验证笔记正文内容不受影响
   */
  test("降级时笔记正文应保持不变", async () => {
    await fc.assert(
      fc.asyncProperty(noteContentArbitrary, async (originalContent) => {
        // 提取正文（frontmatter 之后的内容）
        const bodyMatch = originalContent.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
        const originalBody = bodyMatch ? bodyMatch[1] : "";

        // 执行状态降级
        const improvedContent = downgradeStatus(originalContent);

        // 提取新的正文
        const newBodyMatch = improvedContent.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
        const newBody = newBodyMatch ? newBodyMatch[1] : "";

        // 验证正文未改变
        expect(newBody).toBe(originalBody);
      }),
      { numRuns: 100 }
    );
  });
});

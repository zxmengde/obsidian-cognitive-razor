import { describe, expect, it } from "vitest";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "./frontmatter-utils";

function validNote(overrides: Record<string, string> = {}): string {
  const fields = {
    cruid: "123e4567-e89b-12d3-a456-426614174000",
    type: "entity",
    name: '"测试实体"',
    status: "draft",
    created: '"2026-08-16 12:00:00"',
    updated: '"2026-08-16 12:00:00"',
    aliases: "[]",
    tags: "[]",
    parents: "[]",
    ...overrides,
  };
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\n")}\n---\n\n正文`;
}

describe("frontmatter current contract", () => {
  it("round-trips the single current frontmatter shape", () => {
    const frontmatter = generateFrontmatter({
      cruid: "123e4567-e89b-12d3-a456-426614174000",
      type: "theory",
      name: "测试理论",
      parents: ["Parent", "[[Parent|别名]]", "[[Other#章节]]"],
      aliases: ["00", "true"],
    });
    const parsed = extractFrontmatter(generateMarkdownContent(frontmatter, "# 正文"));

    expect(parsed?.frontmatter).toEqual({
      ...frontmatter,
      parents: ["[[Parent]]", "[[Other]]"],
    });
    expect(parsed?.body).toBe("\n# 正文");
  });

  it("rejects historical aliases and invalid enum values", () => {
    expect(extractFrontmatter(validNote({ cruid: "", crUid: "legacy-id" }))).toBeNull();
    expect(extractFrontmatter(validNote({ type: "Unknown" }))).toBeNull();
    expect(extractFrontmatter(validNote({ status: "Finished" }))).toBeNull();
    expect(extractFrontmatter(validNote({ status: "Draft" }))).toBeNull();
  });

  it("rejects arrays containing non-string values", () => {
    expect(extractFrontmatter(validNote({ tags: "[valid, 42]" }))).toBeNull();
    expect(extractFrontmatter(validNote({ sourceUids: "[one, false]" }))).toBeNull();
  });

  it("ignores unrelated user fields without adding them to the CR data model", () => {
    const parsed = extractFrontmatter(validNote({ cssclasses: "[wide-page]" }));

    expect(parsed).not.toBeNull();
    expect(parsed?.frontmatter).not.toHaveProperty("cssclasses");
  });
});

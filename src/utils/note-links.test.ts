import { describe, expect, it } from "vitest";
import { parseInternalNoteLink, renderInternalNoteLink, renderParentNoteLink, rewriteInternalNoteLink, rewriteParentNoteLink } from "./note-links";
import { confirmConcept, isConfirmedConcept } from "../domain/concept";
import { extractFrontmatter, generateFrontmatter, generateMarkdownContent } from "../core/frontmatter-utils";

describe("internal note names and parent links", () => {
  it('uses unescaped native Wiki values for bracketed Properties and encoded Markdown for the same body name', () => {
    const path = 'E/期望值 E[X].md';
    expect(renderParentNoteLink(path)).toBe('[[E/期望值 E[X]]]');
    expect(renderInternalNoteLink(path)).toContain('E%5BX%5D.md)');
    expect(rewriteParentNoteLink('[旧 E\\[X\\]](Old.md#%E7%AB%A0%E8%8A%82)', path))
      .toBe('[[E/期望值 E[X]#章节|旧 E[X]]]');
    expect(rewriteParentNoteLink('[[Old|旧显示名]]', path)).toBe('[[E/期望值 E[X]|旧显示名]]');
  });
  it('preserves literal pipe data instead of interpreting it as a Properties alias delimiter', () => {
    const path = 'E/期望值 E[X].md';
    expect(rewriteParentNoteLink('[旧 E\\[X\\]](Old.md#Part%7COne)', path))
      .toBe(rewriteInternalNoteLink('[旧 E\\[X\\]](Old.md#Part%7COne)', path));
    expect(rewriteParentNoteLink('[显示|名](Old.md)', path))
      .toBe(rewriteInternalNoteLink('[显示|名](Old.md)', path));
  });
  it.each([
    ['[旧](archive/Redundant.md "title")', '[旧](notes/Canonical.md "title")'],
    ['[旧](<archive/Redundant.md#章节>)', '[旧](<notes/Canonical.md#章节>)'],
    ['[旧]( archive/Redundant.md )', '[旧]( notes/Canonical.md )'],
    ['[旧](archive/Old_(one).md)', '[旧](notes/Canonical.md)'],
  ])('retains valid Markdown destination syntax and titles during repair: %s', (original, repaired) => {
    expect(parseInternalNoteLink(original)?.rest).toBe('');
    expect(rewriteInternalNoteLink(original, 'notes/Canonical.md')).toBe(repaired);
  });
  it('keeps explicit Markdown targets, escaped display labels and section/block fragments during repair', () => {
    expect(rewriteInternalNoteLink('[旧 E\\[X\\]](Old%20Folder/Old.md#^block)', '新根 E[X].md'))
      .toBe('[旧 E\\[X\\]](%E6%96%B0%E6%A0%B9%20E%5BX%5D.md#^block)');
    expect(parseInternalNoteLink(rewriteInternalNoteLink('[[Old|旧显示名]]', '新根 E[X].md')!)?.explicitPath).toBe(true);
    expect(rewriteInternalNoteLink('[外链](https://example.invalid/Old.md)', 'new.md')).toBeUndefined();
  });
  it.each(["期望值 E[X]", "A[B", "A]B", "A[[B]]", "A#B", "A^B", "A%20B"])("preserves %s through the link, domain boundary and frontmatter", name => {
    const link = renderInternalNoteLink(`T/${name}.md`);
    expect(parseInternalNoteLink(link)).toMatchObject({ target: `T/${name}.md`, explicitPath: true, rest: "" });
    const concept = confirmConcept({ type: "entity", name: { chinese: "合成下一层", english: "" }, source: "hierarchical-expand", parents: [link] });
    expect(concept.ok).toBe(true); if (!concept.ok) return;
    expect(isConfirmedConcept(concept.value)).toBe(true);
    const note = generateMarkdownContent(generateFrontmatter({ cruid: "fixture", name: "合成下一层", type: "entity", status: "seed", parents: concept.value.parents }), "");
    const parents = extractFrontmatter(note)?.frontmatter.parents;
    expect(parents).toHaveLength(1);
    expect(parseInternalNoteLink(parents![0])?.target).toBe(`T/${name}`);
    expect(parents![0].startsWith("[[[")).toBe(false);
  });
  it.each(["[[旧名 A[B]]", "[[旧名 E[X]|旧名 E[X]]]", "[[T/旧名 E[X].md#章节|显示名]]"])("reads the existing bracketed wikilink %s", link => {
    expect(parseInternalNoteLink(link)?.target).toContain("旧名");
    expect(parseInternalNoteLink(link)?.rest).toBe("");
  });
  it.each(["[外部](https://example.invalid/x)", "[根路径](/x.md)", "[坏编码](x%QQ.md)", "[[Parent]] 尾随内容", "[遍历](../Parent.md)"])("rejects %s as a confirmed parent", link => {
    expect(confirmConcept({ type: "entity", name: { chinese: "合成", english: "" }, source: "hierarchical-expand", parents: [link] }).ok).toBe(false);
  });
});

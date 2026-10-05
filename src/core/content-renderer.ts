import type { CRType, DirectoryScheme } from "../types";
import { schemaRegistry } from "./schema-registry";
import type { FieldDescription } from "./schema-registry";
import { getMarkdownArrayProjection, STRUCTURAL_LINK_TARGET_TYPES, type MarkdownArrayProjection } from "./projection-catalog";
import { generateFilePath } from "./naming-utils";
import { renderInternalNoteLink } from "../utils/note-links";

export class ContentRenderer {
  renderNoteMarkdown(options: {
    title: string;
    type: CRType;
    content: unknown;
    language: string;
    directoryScheme?: DirectoryScheme;
  }): string {
    const lines: string[] = [`# ${options.title}`, ""];

    const structured = this.renderStructuredContentMarkdown({
      type: options.type,
      content: options.content,
      language: options.language,
      directoryScheme: options.directoryScheme,
    });
    if (structured) {
      lines.push(structured);
    }

    return lines.join("\n");
  }

  renderStructuredContentMarkdown(options: {
    type: CRType;
    content: unknown;
    language: string;
    directoryScheme?: DirectoryScheme;
  }): string {
    let content: unknown = options.content;
    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        // 保留原始字符串
      }
    }

    const lines: string[] = [];

    if (content && typeof content === "object") {
      const descriptors: FieldDescription[] = schemaRegistry.getFieldDescriptions(options.type);
      for (const desc of descriptors) {
        const value = (content as Record<string, unknown>)[desc.name];
        if (value === undefined) continue;
        lines.push(`## ${this.getFieldHeading(desc, options.language)}`);
        lines.push(this.renderValue(value, desc.name, options.directoryScheme));
        lines.push("");
      }
    } else if (typeof content === "string") {
      lines.push(content);
    }

    return lines.join("\n").trimEnd();
  }

  private getFieldHeading(desc: FieldDescription, language: string): string {
    if (language === "zh") {
      return desc.name === "axioms" ? "前提" : desc.description || desc.name;
    }
    return desc.name;
  }

  private renderValue(value: unknown, fieldName: string, directoryScheme?: DirectoryScheme): string {
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        return this.renderObjectArray(value as Record<string, unknown>[], fieldName, directoryScheme);
      }

      return value.map((v) => `- ${String(v)}`).join("\n");
    }

    if (typeof value === "object" && value !== null) {
      return this.renderObject(value as Record<string, unknown>, fieldName);
    }

    return String(value);
  }

  private renderObjectArray(items: Record<string, unknown>[], fieldName: string, directoryScheme?: DirectoryScheme): string {
    if (items.length === 0) return "";
    const projection = getMarkdownArrayProjection(fieldName);
    const targetType = STRUCTURAL_LINK_TARGET_TYPES[fieldName];
    const link = (name: string): string => {
      if (!directoryScheme || !targetType) return renderInternalNoteLink(name);
      const filePath = generateFilePath(name, directoryScheme, targetType);
      // Root targets need an explicit extension to distinguish them from a
      // legacy bare title when the configured directory later changes.
      const path = filePath.includes("/") ? filePath.replace(/\.md$/i, "") : filePath;
      return renderInternalNoteLink(/[[\]#^|%]/.test(`${path}${name}`) ? filePath : path, name);
    };
    return projection ? this.renderProjectedArray(items, projection, link) : this.renderGenericObjectArray(items);
  }

  private renderProjectedArray(items: Record<string, unknown>[], projection: MarkdownArrayProjection, link: (name: string) => string): string {
    switch (projection) {
      case "linked-name-description": return this.renderLinkedNameDescriptions(items, link);
      case "plain-name-description": return this.renderPlainNameDescriptions(items);
      case "stakeholder-perspective": return this.renderStakeholderPerspectives(items);
      case "theory": return this.renderTheories(items, link);
      case "axiom": return this.renderAxioms(items);
      case "theory-entity": return this.renderTheoryEntities(items, link);
      case "theory-mechanism": return this.renderTheoryMechanisms(items, link);
      case "entity-property": return this.renderEntityProperties(items);
      case "operates-on": return this.renderOperatesOn(items);
      case "causal-chain": return this.renderCausalChain(items);
      case "modulation": return this.renderModulation(items);
    }
  }

  private renderLinkedNameDescriptions(items: Record<string, unknown>[], link: (name: string) => string): string {
    return this.renderNameDescriptionArray(items, link);
  }

  private renderPlainNameDescriptions(items: Record<string, unknown>[]): string {
    return this.renderNameDescriptionArray(items);
  }

  private renderNameDescriptionArray(items: Record<string, unknown>[], link?: (name: string) => string): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const description = String(item.description || "");
        return link ? `- ${link(name)}：${description}` : `- **${name}**：${description}`;
      })
      .join("\n");
  }

  private renderStakeholderPerspectives(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const stakeholder = String(item.stakeholder || "");
        const perspective = String(item.perspective || "");
        return `- **${stakeholder}**：${perspective}`;
      })
      .join("\n");
  }

  private renderTheories(items: Record<string, unknown>[], link: (name: string) => string): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const status = String(item.status || "");
        const brief = String(item.brief || "");
        const statusLabel = this.getTheoryStatusLabel(status);
        return `- ${link(name)} (${statusLabel})：${brief}`;
      })
      .join("\n");
  }

  private renderAxioms(items: Record<string, unknown>[]): string {
    return items
      .map((item, index) => {
        const statement = String(item.statement || "");
        const justification = String(item.justification || "");
        return `### 前提 ${index + 1}：${statement}\n- **理由**：${justification}`;
      })
      .join("\n\n");
  }

  private renderTheoryEntities(items: Record<string, unknown>[], link: (name: string) => string): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const role = String(item.role || "");
        const attributes = String(item.attributes || "");
        return `- ${link(name)}\n  - **角色**：${role}\n  - **属性**：${attributes}`;
      })
      .join("\n");
  }

  private renderTheoryMechanisms(items: Record<string, unknown>[], link: (name: string) => string): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const process = String(item.process || "");
        const func = String(item.function || "");
        return `- ${link(name)}\n  - **过程**：${process}\n  - **功能**：${func}`;
      })
      .join("\n");
  }

  private renderEntityProperties(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const type = String(item.type || "");
        const description = String(item.description || "");
        return `- **${name}** (${type})：${description}`;
      })
      .join("\n");
  }

  private renderOperatesOn(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const entity = String(item.entity || "");
        const role = String(item.role || "");
        return `- ${role}：${entity}`;
      })
      .join("\n");
  }

  private renderCausalChain(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const step = item.step;
        const description = String(item.description || "");
        const interaction = String(item.interaction || "");
        return `### 步骤 ${step}：${interaction}\n- ${description}`;
      })
      .join("\n\n");
  }

  private renderModulation(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const factor = String(item.factor || "");
        const effect = String(item.effect || "");
        const mechanism = String(item.mechanism || "");
        const effectLabel = this.getModulationEffectLabel(effect);
        return `- **${factor}** (${effectLabel})：${mechanism}`;
      })
      .join("\n");
  }

  private renderGenericObjectArray(items: Record<string, unknown>[]): string {
    return items
      .map((item, index) => {
        const entries = Object.entries(item)
          .map(([k, v]) => `  - **${k}**：${String(v)}`)
          .join("\n");
        return `- 项目 ${index + 1}\n${entries}`;
      })
      .join("\n");
  }

  private renderObject(obj: Record<string, unknown>, fieldName: string): string {
    switch (fieldName) {
      case "composition": {
        const hasParts = Array.isArray(obj.has_parts) ? obj.has_parts.map(String).map((part) => part.trim()).filter(Boolean) : [];
        const partOf = String(obj.part_of || "").trim();
        return `- **组成部分**：${hasParts.length > 0 ? hasParts.join("、") : "未提供"}\n- **所属系统**：${partOf || "未提供"}`;
      }
      case "classification": {
        const genus = String(obj.genus || "");
        const differentia = String(obj.differentia || "");
        return `- **属**：${genus}\n- **种差**：${differentia}`;
      }
    }

    return Object.entries(obj)
      .map(([k, v]) => `- **${k}**：${String(v)}`)
      .join("\n");
  }

  private getTheoryStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      mainstream: "主流",
      marginal: "边缘",
      falsified: "证伪",
      contested: "争议",
      unclear: "不明确"
    };
    return labels[status] || status;
  }

  private getModulationEffectLabel(effect: string): string {
    const labels: Record<string, string> = {
      promotes: "促进",
      inhibits: "抑制",
      regulates: "调节"
    };
    return labels[effect] || effect;
  }
}

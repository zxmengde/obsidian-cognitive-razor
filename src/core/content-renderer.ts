import type { CRType } from "../types";
import { schemaRegistry } from "./schema-registry";
import type { FieldDescription } from "./schema-registry";

export class ContentRenderer {
  renderNoteMarkdown(options: {
    title: string;
    type: CRType;
    content: unknown;
    language: string;
  }): string {
    const lines: string[] = [`# ${options.title}`, ""];

    const structured = this.renderStructuredContentMarkdown({
      type: options.type,
      content: options.content,
      language: options.language,
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
        lines.push(this.renderValue(value, desc.name));
        lines.push("");
      }
    } else if (typeof content === "string") {
      lines.push(content);
    }

    return lines.join("\n").trimEnd();
  }

  private getFieldHeading(desc: FieldDescription, language: string): string {
    if (language === "zh") {
      return desc.description || desc.name;
    }
    return desc.name;
  }

  private renderValue(value: unknown, fieldName?: string): string {
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        return this.renderObjectArray(value as Record<string, unknown>[], fieldName);
      }

      return value.map((v) => `- ${String(v)}`).join("\n");
    }

    if (typeof value === "object" && value !== null) {
      return this.renderObject(value as Record<string, unknown>, fieldName);
    }

    return String(value);
  }

  private renderObjectArray(items: Record<string, unknown>[], fieldName?: string): string {
    if (items.length === 0) return "";

    switch (fieldName) {
      case "sub_domains":
      case "issues":
        return this.renderNameDescriptionArray(items, true);

      case "sub_issues":
        return this.renderNameDescriptionArray(items, true);
      case "stakeholder_perspectives":
        return this.renderStakeholderPerspectives(items);
      case "theories":
        return this.renderTheories(items);

      case "axioms":
        return this.renderAxioms(items);
      case "sub_theories":
        return this.renderNameDescriptionArray(items, true);
      case "entities":
        return this.renderTheoryEntities(items);
      case "mechanisms":
        return this.renderTheoryMechanisms(items);

      case "properties":
        return this.renderEntityProperties(items);
      case "states":
        return this.renderNameDescriptionArray(items, false);

      case "operates_on":
        return this.renderOperatesOn(items);
      case "causal_chain":
        return this.renderCausalChain(items);
      case "modulation":
        return this.renderModulation(items);
    }

    return this.renderObjectArrayByStructure(items);
  }

  private renderNameDescriptionArray(items: Record<string, unknown>[], withLink: boolean): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const description = String(item.description || "");
        return withLink ? `- [[${name}]]：${description}` : `- **${name}**：${description}`;
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

  private renderTheories(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const status = String(item.status || "");
        const brief = String(item.brief || "");
        const statusLabel = this.getTheoryStatusLabel(status);
        return `- [[${name}]] (${statusLabel})：${brief}`;
      })
      .join("\n");
  }

  private renderAxioms(items: Record<string, unknown>[]): string {
    return items
      .map((item, index) => {
        const statement = String(item.statement || "");
        const justification = String(item.justification || "");
        return `### 公理 ${index + 1}：${statement}\n- **理由**：${justification}`;
      })
      .join("\n\n");
  }

  private renderTheoryEntities(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const role = String(item.role || "");
        const attributes = String(item.attributes || "");
        return `- [[${name}]]\n  - **角色**：${role}\n  - **属性**：${attributes}`;
      })
      .join("\n");
  }

  private renderTheoryMechanisms(items: Record<string, unknown>[]): string {
    return items
      .map((item) => {
        const name = String(item.name || "");
        const process = String(item.process || "");
        const func = String(item.function || "");
        return `- [[${name}]]\n  - **过程**：${process}\n  - **功能**：${func}`;
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

  private renderObjectArrayByStructure(items: Record<string, unknown>[]): string {
    const firstItem = items[0];

    if ("name" in firstItem && "type" in firstItem && "description" in firstItem) {
      return this.renderEntityProperties(items);
    }

    if ("statement" in firstItem && "justification" in firstItem) {
      return this.renderAxioms(items);
    }

    if ("name" in firstItem && "role" in firstItem && "attributes" in firstItem) {
      return this.renderTheoryEntities(items);
    }

    if ("name" in firstItem && "process" in firstItem && "function" in firstItem) {
      return this.renderTheoryMechanisms(items);
    }

    if ("name" in firstItem && "status" in firstItem && "brief" in firstItem) {
      return this.renderTheories(items);
    }

    if ("stakeholder" in firstItem && "perspective" in firstItem) {
      return this.renderStakeholderPerspectives(items);
    }

    if ("entity" in firstItem && "role" in firstItem) {
      return this.renderOperatesOn(items);
    }

    if ("step" in firstItem && "description" in firstItem && "interaction" in firstItem) {
      return this.renderCausalChain(items);
    }

    if ("factor" in firstItem && "effect" in firstItem && "mechanism" in firstItem) {
      return this.renderModulation(items);
    }

    if ("name" in firstItem && "description" in firstItem) {
      return this.renderNameDescriptionArray(items, true);
    }

    return items
      .map((item, index) => {
        const entries = Object.entries(item)
          .map(([k, v]) => `  - **${k}**：${String(v)}`)
          .join("\n");
        return `- 项目 ${index + 1}\n${entries}`;
      })
      .join("\n");
  }

  private renderObject(obj: Record<string, unknown>, _fieldName?: string): string {
    if ("has_parts" in obj && "part_of" in obj) {
      const hasParts = obj.has_parts as string[];
      const partOf = String(obj.part_of || "");
      const partsStr = Array.isArray(hasParts) && hasParts.length > 0 ? hasParts.join("、") : "无";
      return `- **组成部分**：${partsStr}\n- **所属系统**：${partOf || "无"}`;
    }

    if ("genus" in obj && "differentia" in obj) {
      const genus = String(obj.genus || "");
      const differentia = String(obj.differentia || "");
      return `- **属**：${genus}\n- **种差**：${differentia}`;
    }

    return Object.entries(obj)
      .map(([k, v]) => `- **${k}**：${String(v)}`)
      .join("\n");
  }

  private getTheoryStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      mainstream: "主流",
      marginal: "边缘",
      falsified: "已证伪"
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


import { normalizePath, Notice, TFile } from "obsidian";
import type CognitiveRazorPlugin from "../main";

type PromptKey =
	| "system_core"
	| "l2_pre_standardizer"
	| "l3_agent_a_domain"
	| "l3_agent_b_issue"
	| "l3_agent_c_theory"
	| "l3_agent_d_principle"
	| "l2_reflex_validate";

interface PromptRecord {
	mtime: number;
	content: string;
}

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
	system_core: `You are the "Cognitive Razor," an axiomatic logic engine designed to compile high-entropy information into a strictly typed, logically consistent Knowledge Graph.

- Output language: Simplified Chinese only.
- Naming convention: 中文术语 (English Term).
- Avoid fluff, metaphors without mechanism, circular definitions.
- Output valid JSON only; do not wrap in Markdown fences.`,
	l2_pre_standardizer: `Task: Standardize the input term into a Canonical Academic Name and predict its Type.

Input: "{{user_input}}"

Rules:
1. Canonical Name format: 中文术语 (English Term).
2. Type ∈ [Domain, Issue, Theory, Entity, Mechanism, Principle].
3. Folder mapping:
   - Domain -> "01_Domains"
   - Issue -> "02_Issues"
   - Theory -> "03_Theories"
   - Entity -> "04_Entities"
   - Mechanism -> "05_Mechanisms"
   - Principle -> "06_Principles"

Output JSON:
{
  "standard_name": "xxx",
  "type": "Entity",
  "folder": "04_Entities",
  "aliases": ["Alias1", "Alias2"],
  "confidence": 0.9
}`,
	l3_agent_a_domain: `Target Domain: "{{domain_name}}"

Task: Construct a holographic map of this domain with MECE sub-domains and emergent issues.

Output JSON:
{
  "_thought_trace": "Deductive reasoning...",
  "metadata": { "name": "{{domain_name}}", "type": "Domain" },
  "content": {
    "definition": "严谨中文定义",
    "teleology": "领域终点",
    "deep_understanding": "综合论述"
  },
  "structure": {
    "sub_domains": [{ "name": "xxx (yyy)", "rationale": "为何划分" }],
    "emergent_issues": [{ "name": "xxx (yyy)", "mechanism": "因果机理" }]
  }
}`,
	l3_agent_b_issue: `Target Issue: "{{issue_name}}"
Context: "{{parent_context}}"

Task: Trace origins, core tension, and theories resolving it.

Output JSON:
{
  "_thought_trace": "Causal tracing...",
  "metadata": { "name": "{{issue_name}}", "type": "Issue" },
  "content": {
    "origin": "起源",
    "core_tension": "张力",
    "analysis": "分析"
  },
  "theories": [{ "name": "xxx (yyy)", "status": "Mainstream", "premise": "公理" }]
}`,
	l3_agent_c_theory: `Target Theory: "{{theory_name}}"

Context (Existing Entities/Mechanisms):
{{vault_index}}

Task: Reconstruct logic and deduplicate against context.

Output JSON:
{
  "_thought_trace": "Deduction...",
  "metadata": { "name": "{{theory_name}}", "type": "Theory" },
  "content": {
    "axioms": ["前提1", "前提2"],
    "argument_chain": "逻辑链",
    "limitations": "局限"
  },
  "extracted_components": [{
    "name": "xxx (yyy)",
    "category": "Entity",
    "status": "NEW | EXISTING",
    "uid": "uuid-or-null",
    "match_reason": "为何匹配/新增",
    "definition": "若为新建则提供定义",
    "attributes": {}
  }]
}`,
	l3_agent_d_principle: `Input Mechanisms:
{{input_mechanisms}}

Task: Distill a universal Principle (去参数化、形式化).

Output JSON:
{
  "_thought_trace": "Abstracting...",
  "metadata": { "name": "xxx (yyy)", "type": "Principle" },
  "content": {
    "formal_statement": "IF...THEN...",
    "mathematical_form": "$y=f(x)$",
    "variables": { "X": "定义", "Y": "定义" },
    "isomorphism_analysis": "为何同构"
  }
}`,
	l2_reflex_validate: `Task: Validate the JSON structure and content logic.

Input JSON:
{{generated_json}}

Output JSON:
{
  "status": "PASS | FAIL",
  "issues": ["错误1", "错误2"],
  "corrected_json": { }
}`,
};

export class PromptManager {
	private cache: Map<PromptKey, PromptRecord> = new Map();
	private promptDir: string;

	constructor(private plugin: CognitiveRazorPlugin) {
		this.promptDir = normalizePath(
			`.obsidian/plugins/${this.plugin.manifest.id}/prompts`,
		);
	}

	private async readPromptFile(key: PromptKey): Promise<PromptRecord | null> {
		const path = normalizePath(`${this.promptDir}/${key}.md`);
		const adapter = this.plugin.app.vault.adapter;
		const exists = await adapter.exists(path);
		if (!exists) return null;
		const stat = await adapter.stat(path);
		const content = await adapter.read(path);
		return {
			mtime: stat?.mtime || Date.now(),
			content,
		};
	}

	private fill(template: string, variables: Record<string, string>): string {
		let result = template;
		Object.entries(variables).forEach(([key, value]) => {
			const pattern = new RegExp(`{{\\s*${key}\\s*}}`, "g");
			result = result.replace(pattern, value);
		});
		return result;
	}

	async getPrompt(key: PromptKey, vars: Record<string, string> = {}): Promise<string> {
		const cached = this.cache.get(key);
		if (cached) {
			return this.fill(cached.content, vars);
		}

		const fileRecord = await this.readPromptFile(key);
		if (fileRecord) {
			this.cache.set(key, fileRecord);
			return this.fill(fileRecord.content, vars);
		}

		const fallback = DEFAULT_PROMPTS[key];
		if (!fallback) {
			new Notice(`未找到提示词：${key}`);
			return "";
		}
		this.cache.set(key, { content: fallback, mtime: Date.now() });
		return this.fill(fallback, vars);
	}

	clearCache() {
		this.cache.clear();
	}
}

export type { PromptKey };

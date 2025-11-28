import { Notice, requestUrl } from "obsidian";
import type CognitiveRazorPlugin from "../main";
import type { CognitiveRazorSettings } from "./settings";
import type { AgentResult } from "./types";
import type { PromptKey } from "./promptManager";
import { PromptManager } from "./promptManager";

interface JsonResponse<T> {
	success: boolean;
	data?: T;
	error?: string;
	rawText?: string;
}

const MAX_RETRY = 3;

export class LLMService {
	private settings: CognitiveRazorSettings;

	constructor(
		private plugin: CognitiveRazorPlugin,
		settings: CognitiveRazorSettings,
		private promptManager: PromptManager,
	) {
		this.settings = settings;
	}

	updateSettings(settings: CognitiveRazorSettings) {
		this.settings = settings;
	}

	private async requestWithBackoff<T>(
		requestBody: Record<string, unknown>,
		model: string,
	): Promise<JsonResponse<T>> {
		if (!this.settings.apiBaseUrl) {
			return { success: false, error: "请在设置中填入 API Base URL" };
		}
		if (!model) {
			return { success: false, error: "模型名称为空，请检查设置" };
		}

		let lastError: string | undefined;
		for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
			const delay = attempt === 0 ? 0 : Math.pow(2, attempt) * 500;
			if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (this.settings.apiKey) {
					headers.Authorization = `Bearer ${this.settings.apiKey}`;
				}
				const response = await requestUrl({
					url: `${this.settings.apiBaseUrl}/chat/completions`,
					method: "POST",
					headers,
					body: JSON.stringify({
						model,
						messages: requestBody.messages,
						response_format: { type: "json_object" },
						temperature: 0.4,
					}),
				});
				const choice = response.json?.choices?.[0];
				const content = choice?.message?.content;
				if (!content || typeof content !== "string") {
					lastError = "LLM 返回内容为空";
					continue;
				}
				const parsed = this.tryParseJson<T>(content);
				if (!parsed.success) {
					lastError = parsed.error;
					continue;
				}
				return { success: true, data: parsed.data, rawText: content };
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
		}
		return { success: false, error: lastError ?? "LLM 请求失败" };
	}

	private tryParseJson<T>(text: string): JsonResponse<T> {
		try {
			return { success: true, data: JSON.parse(text), rawText: text };
		} catch (e) {
			// 尝试截取第一个大括号
			const match = text.match(/\{[\s\S]*\}/);
			if (match) {
				try {
					return {
						success: true,
						data: JSON.parse(match[0]),
						rawText: text,
					};
				} catch (err) {
					return { success: false, error: `JSON 解析失败: ${err}` };
				}
			}
			return { success: false, error: "未能解析 JSON" };
		}
	}

	private async generate<T>(
		promptKey: PromptKey,
		vars: Record<string, string>,
		model: string,
	): Promise<AgentResult<T>> {
		const system = await this.promptManager.getPrompt("system_core");
		const prompt = await this.promptManager.getPrompt(promptKey, vars);
		const messages = [
			{ role: "system", content: system },
			{ role: "user", content: prompt },
		];
		const resp = await this.requestWithBackoff<T>({ messages }, model);
		if (!resp.success) {
			new Notice(`LLM 请求失败：${resp.error}`);
			return { rawText: resp.rawText ?? "", issues: [resp.error ?? ""] };
		}
		return { rawText: resp.rawText ?? "", parsed: resp.data };
	}

	async standardize(term: string) {
		return this.generate(
			"l2_pre_standardizer",
			{ user_input: term },
			this.settings.standardizerModel,
		);
	}

	async agentDomain(domainName: string) {
		return this.generate(
			"l3_agent_a_domain",
			{ domain_name: domainName },
			this.settings.brainModel,
		);
	}

	async agentIssue(issueName: string, parentContext: string) {
		return this.generate(
			"l3_agent_b_issue",
			{ issue_name: issueName, parent_context: parentContext },
			this.settings.brainModel,
		);
	}

	async agentTheory(theoryName: string, vaultIndex: string) {
		return this.generate(
			"l3_agent_c_theory",
			{ theory_name: theoryName, vault_index: vaultIndex },
			this.settings.brainModel,
		);
	}

	async agentPrinciple(inputMechanisms: string) {
		return this.generate(
			"l3_agent_d_principle",
			{ input_mechanisms: inputMechanisms },
			this.settings.brainModel,
		);
	}

	async validateJson(generatedJson: string) {
		return this.generate(
			"l2_reflex_validate",
			{ generated_json: generatedJson },
			this.settings.reflexModel,
		);
	}

	async embedText(text: string): Promise<number[] | null> {
		if (!this.settings.embeddingModel) {
			new Notice("未配置 Embedding 模型");
			return null;
		}
		let lastError: string | undefined;
		for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
			const delay = attempt === 0 ? 0 : Math.pow(2, attempt) * 500;
			if (delay) await new Promise((r) => setTimeout(r, delay));
			try {
				const headers: Record<string, string> = {
					"Content-Type": "application/json",
				};
				if (this.settings.apiKey) {
					headers.Authorization = `Bearer ${this.settings.apiKey}`;
				}
				const response = await requestUrl({
					url: `${this.settings.apiBaseUrl}/embeddings`,
					method: "POST",
					headers,
					body: JSON.stringify({
						model: this.settings.embeddingModel,
						input: text,
					}),
				});
				const vector = response.json?.data?.[0]?.embedding;
				if (!Array.isArray(vector)) {
					lastError = "Embedding 返回为空";
					continue;
				}
				return vector as number[];
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
		}
		if (lastError) new Notice(`Embedding 失败：${lastError}`);
		return null;
	}
}

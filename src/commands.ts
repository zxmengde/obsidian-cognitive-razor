import { Notice, normalizePath, TFile, moment } from "obsidian";
import type CognitiveRazorPlugin from "../main";
import type { NoteContext, StandardizeResult } from "./types";
import { TextInputModal } from "./ui/textInputModal";
import { ResultModal } from "./ui/resultModal";

const FRONTMATTER_TEMPLATE = ({
	uid,
	type,
	aliases,
}: {
	uid: string;
	type: string;
	aliases: string[];
}) => `---
uid: "${uid}"
type: "${type}"
aliases:
${aliases.map((a) => `  - "${a}"`).join("\n")}
tags: []
status: "Evergreen"
created: "${moment().toISOString()}"
updated: "${moment().toISOString()}"
---\n\n`;

function getActiveContext(
	plugin: CognitiveRazorPlugin,
): NoteContext {
	const file = plugin.app.workspace.getActiveFile();
	if (!file) return { file: null, title: "" };
	const cache = plugin.app.metadataCache.getFileCache(file);
	const fm = cache?.frontmatter;
	const type = fm?.type;
	const title = file.basename;
	return { file, title, type };
}

async function ensureFolder(plugin: CognitiveRazorPlugin, folderPath: string) {
	const adapter = plugin.app.vault.adapter;
	if (!(await adapter.exists(folderPath))) {
		await plugin.app.vault.createFolder(folderPath);
	}
}

async function createOrOpenNote(
	plugin: CognitiveRazorPlugin,
	standard: StandardizeResult,
) {
	const folderPath = normalizePath(standard.folder);
	await ensureFolder(plugin, folderPath);
	const filePath = normalizePath(`${folderPath}/${standard.standard_name}.md`);
	const existing = plugin.app.vault.getAbstractFileByPath(filePath);
	if (existing instanceof TFile) {
		await plugin.app.workspace.openLinkText(filePath, "", true);
		return existing;
	}
	const uid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
	const content = FRONTMATTER_TEMPLATE({
		uid,
		type: standard.type,
		aliases: standard.aliases || [],
	});
	const file = await plugin.app.vault.create(filePath, content);
	await plugin.app.workspace.openLinkText(filePath, "", true);
	return file;
}

export function registerCommands(plugin: CognitiveRazorPlugin) {
	plugin.addCommand({
		id: "cr-init-node",
		name: "CR: Initialize Node",
		callback: () => {
			new TextInputModal(plugin.app, {
				title: "标准化输入",
				placeholder: "输入领域/议题/理论/实体/机制/原理名称",
				onSubmit: async (value) => {
					if (!value) {
						new Notice("请输入内容");
						return;
					}
					plugin.setStatus("L2 标准化中...");
					const result = await plugin.llm.standardize(value);
					const parsed = result.parsed as StandardizeResult | undefined;
					if (!parsed?.standard_name) {
						new Notice("标准化失败，请检查配置");
						return;
					}
					const file = await createOrOpenNote(plugin, parsed);
					plugin.setStatus(`已打开：${file.path}`);
				},
			}).open();
		},
	});

	plugin.addCommand({
		id: "cr-agent-domain",
		name: "CR: Agent A - Domain Mapper",
		checkCallback: (checking) => {
			if (checking) return true;
			const ctx = getActiveContext(plugin);
			const domainName = ctx.title || "";
			const run = (name: string) => plugin.runAgentDomain(name, ctx.file);
			if (!domainName) {
				new TextInputModal(plugin.app, {
					title: "输入领域名称",
					placeholder: "示例：博弈论 (Game Theory)",
					onSubmit: (val) => val && run(val),
				}).open();
			} else {
				run(domainName);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "cr-agent-issue",
		name: "CR: Agent B - Issue Probe",
		checkCallback: (checking) => {
			if (checking) return true;
			const ctx = getActiveContext(plugin);
			const run = (name: string) => plugin.runAgentIssue(name, ctx.file);
			if (!ctx.title) {
				new TextInputModal(plugin.app, {
					title: "输入议题名称",
					placeholder: "示例：公平-效率权衡 (Equity-Efficiency Tradeoff)",
					onSubmit: (val) => val && run(val),
				}).open();
			} else {
				run(ctx.title);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "cr-agent-theory",
		name: "CR: Agent C - Theory Deconstructor",
		checkCallback: (checking) => {
			if (checking) return true;
			const ctx = getActiveContext(plugin);
			const run = (name: string) => plugin.runAgentTheory(name, ctx.file);
			if (!ctx.title) {
				new TextInputModal(plugin.app, {
					title: "输入理论名称",
					placeholder: "示例：信息不对称 (Information Asymmetry)",
					onSubmit: (val) => val && run(val),
				}).open();
			} else {
				run(ctx.title);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: "cr-agent-principle",
		name: "CR: Agent D - Principle Synthesizer",
		checkCallback: (checking) => {
			if (checking) return true;
			const ctx = getActiveContext(plugin);
			const run = (payload: string) =>
				plugin.runAgentPrinciple(payload, ctx.file);

			new TextInputModal(plugin.app, {
				title: "输入机制列表 JSON",
				placeholder:
					'[{"name":"机制A (Mechanism A)"},{"name":"机制B (Mechanism B)"}]',
				defaultValue: "[]",
				onSubmit: (val) => run(val),
			}).open();
			return true;
		},
	});
}

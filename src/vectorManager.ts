import { normalizePath, TFile, debounce } from "obsidian";
import type CognitiveRazorPlugin from "../main";
import type { LLMService } from "./llmService";
import type {
	CognitiveNodeType,
	SimilarEntry,
	VectorCache,
	VectorCacheEntry,
} from "./types";

const CACHE_VERSION = 1;
const TARGET_FOLDERS = [
	"00_Index",
	"01_Domains",
	"02_Issues",
	"03_Theories",
	"04_Entities",
	"05_Mechanisms",
	"06_Principles",
];

export class VectorManager {
	private cache: VectorCache = { version: CACHE_VERSION, entries: {} };
	private cachePath: string;
	private saveCacheDebounced: () => void;
	private isIndexing = false;

	constructor(
		private plugin: CognitiveRazorPlugin,
		private llm: LLMService,
	) {
		this.cachePath = normalizePath(
			this.plugin.settings.vectorCachePath ||
				`.obsidian/plugins/${this.plugin.manifest.id}/vector_cache.json`,
		);
		this.saveCacheDebounced = debounce(
			this.saveCache.bind(this),
			1000,
			true,
		);
	}

	async loadCache() {
		const adapter = this.plugin.app.vault.adapter;
		if (!(await adapter.exists(this.cachePath))) {
			return;
		}
		try {
			const content = await adapter.read(this.cachePath);
			const data = JSON.parse(content) as VectorCache;
			if (data.version === CACHE_VERSION && data.entries) {
				this.cache = data;
			}
		} catch (err) {
			console.error("读取向量缓存失败", err);
		}
	}

	private async saveCache() {
		const adapter = this.plugin.app.vault.adapter;
		try {
			await adapter.write(
				this.cachePath,
				JSON.stringify(this.cache, null, 2),
			);
		} catch (err) {
			console.error("写入向量缓存失败", err);
		}
	}

	async initializeIndex(): Promise<string[]> {
		if (this.isIndexing) return [];
		this.isIndexing = true;
		await this.loadCache();
		const updated = await this.refreshIndex();
		this.isIndexing = false;
		return updated;
	}

	private isTargetFile(file: TFile): boolean {
		return (
			file.extension === "md" &&
			TARGET_FOLDERS.some((folder) => file.path.startsWith(`${folder}/`))
		);
	}

	getTitle(path: string) {
		return path.split("/").pop()?.replace(/\.md$/, "") ?? path;
	}

	async refreshIndex(): Promise<string[]> {
		const files = this.plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => this.isTargetFile(f));
		const adapter = this.plugin.app.vault.adapter;
		const existingPaths = new Set(Object.keys(this.cache.entries));
		const updatedPaths: string[] = [];

		for (const file of files) {
			existingPaths.delete(file.path);
			const cached = this.cache.entries[file.path];
			if (cached && cached.mtime >= file.stat.mtime) {
				continue;
			}
			const success = await this.updateFileEmbedding(file);
			if (success) {
				updatedPaths.push(file.path);
			}
		}

		// 清理已删除文件
		for (const removed of existingPaths) {
			delete this.cache.entries[removed];
		}

		// 确保缓存文件目录存在
		const dir = this.cachePath.split("/").slice(0, -1).join("/");
		if (!(await adapter.exists(dir))) {
			await adapter.mkdir(dir);
		}

		this.saveCacheDebounced();
		return updatedPaths;
	}

	private async readNoteContent(file: TFile): Promise<string> {
		const raw = await this.plugin.app.vault.read(file);
		return raw;
	}

	private extractType(uidType?: unknown): CognitiveNodeType {
		if (
			uidType === "Domain" ||
			uidType === "Issue" ||
			uidType === "Theory" ||
			uidType === "Entity" ||
			uidType === "Mechanism" ||
			uidType === "Principle"
		) {
			return uidType;
		}
		return this.plugin.settings.defaultType;
	}

	private buildUid(path: string) {
		if (typeof crypto?.randomUUID === "function") {
			return crypto.randomUUID();
		}
		return `${Date.now()}-${path}`;
	}

	private async updateFileEmbedding(file: TFile): Promise<boolean> {
		const meta = this.plugin.app.metadataCache.getFileCache(file);
		const frontmatter = meta?.frontmatter ?? {};
		const uid: string = frontmatter.uid || this.buildUid(file.path);
		const type = this.extractType(frontmatter.type);
		const content = await this.readNoteContent(file);
		const embedding = await this.llm.embedText(content);
		if (!embedding) {
			return false;
		}
		this.cache.entries[file.path] = {
			mtime: file.stat.mtime,
			uid,
			type,
			vector: embedding,
		};
		return true;
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		const minLength = Math.min(a.length, b.length);
		let dot = 0;
		let na = 0;
		let nb = 0;
		for (let i = 0; i < minLength; i++) {
			dot += a[i] * b[i];
			na += a[i] * a[i];
			nb += b[i] * b[i];
		}
		if (na === 0 || nb === 0) return 0;
		return dot / (Math.sqrt(na) * Math.sqrt(nb));
	}

	async search(text: string, limit = 10): Promise<SimilarEntry[]> {
		const queryEmbedding = await this.llm.embedText(text);
		if (!queryEmbedding) return [];
		const scores: SimilarEntry[] = [];
		for (const [path, entry] of Object.entries(this.cache.entries)) {
			const score = this.cosineSimilarity(queryEmbedding, entry.vector);
			scores.push({
				path,
				score,
				uid: entry.uid,
				type: entry.type,
				title: this.getTitle(path),
			});
		}
		return scores
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.filter((item) => item.score > 0);
	}

	getEntry(path: string) {
		return this.cache.entries[path];
	}

	findSimilarByPath(path: string, limit = 10): SimilarEntry[] {
		const source = this.cache.entries[path];
		if (!source) return [];
		const scores: SimilarEntry[] = [];
		for (const [otherPath, entry] of Object.entries(this.cache.entries)) {
			if (otherPath === path) continue;
			const score = this.cosineSimilarity(source.vector, entry.vector);
			scores.push({
				path: otherPath,
				score,
				uid: entry.uid,
				type: entry.type,
				title: this.getTitle(otherPath),
			});
		}
		return scores
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.filter((item) => item.score > 0);
	}
}

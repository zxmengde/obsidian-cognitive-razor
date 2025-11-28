import { normalizePath } from "obsidian";
import type { CognitiveNodeType } from "./types";

export interface CognitiveRazorSettings {
	apiBaseUrl: string;
	apiKey: string;
	brainModel: string;
	reflexModel: string;
	standardizerModel: string;
	embeddingModel: string;
	requestTimeout: number;
	autoIndexOnLoad: boolean;
	vectorCachePath: string;
	insightSimilarity: number;
	maxSimilarResults: number;
	defaultType: CognitiveNodeType;
}

export const DEFAULT_SETTINGS: CognitiveRazorSettings = {
	apiBaseUrl: "https://api.openai.com/v1",
	apiKey: "",
	brainModel: "gpt-4o-mini", // 可改为 gemini-1.5-pro 等
	reflexModel: "gpt-4o-mini",
	standardizerModel: "gpt-4o-mini",
	embeddingModel: "text-embedding-3-small",
	requestTimeout: 30_000,
	autoIndexOnLoad: true,
	vectorCachePath: normalizePath(
		".obsidian/plugins/obsidian-cognitive-razor/vector_cache.json",
	),
	insightSimilarity: 0.85,
	maxSimilarResults: 50,
	defaultType: "Entity",
};

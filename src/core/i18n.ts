/**
 * 国际化（i18n）模块 — 简化版（仅中文）
 *
 * 功能：
 * - 从 zh.json 加载翻译内容（构建时通过 esbuild JSON loader 内联）
 * - 支持 t(key) 键路径查找和 format(key, params) 占位符插值
 * - 保留 t() / format() / onLanguageChange() 接口签名，避免大量 Svelte 组件改动
 */

import zhLocale from "../locales/zh.json";
import type { ILogger } from "../types";

/**
 * 翻译数据类型（嵌套 JSON 对象）
 */
type TranslationData = Record<string, unknown>;

/**
 * i18n 管理器（中文单语版）
 *
 * 设计决策：移除多语言切换，硬编码中文。
 * 保留 t() / format() / onLanguageChange() 接口以兼容现有 Svelte 组件。
 */
export class I18n {
    private readonly translationData: TranslationData;
    private logger: ILogger | null = null;

    constructor() {
        this.translationData = zhLocale as TranslationData;
    }

    /**
     * 设置 Logger 实例（延迟注入，避免循环依赖）
     */
    setLogger(logger: ILogger): void {
        this.logger = logger;
    }

    /**
     * 获取当前语言（始终返回 "zh"）
     */
    getLanguage(): "zh" {
        return "zh";
    }

    /**
     * 设置语言（no-op，保留接口兼容）
     */
    setLanguage(_language: string): void {
        // 中文单语版，忽略语言切换
    }

    /**
     * 通过键路径获取翻译文本
     *
     * 支持两种调用方式：
     * - t("workbench.buttons.verify") → 返回对应翻译字符串
     * - t() → 返回完整翻译对象（向后兼容 Svelte 组件）
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t(): any;
    t(key: string): string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t(key?: string): string | any {
        if (key === undefined) {
            // 向后兼容：返回完整翻译对象供属性访问
            return this.translationData;
        }
        return this.resolveKey(key);
    }

    /**
     * 带参数插值的翻译
     *
     * 支持 {param} 占位符，例如：
     *   format("notices.providerAdded", { id: "openai" })
     *   → "Provider openai 已添加"
     */
    format(key: string, params: Record<string, string | number>): string {
        const template = this.resolveKey(key);
        return formatMessage(template, params);
    }

    /**
     * 注册语言切换监听器（no-op，保留接口兼容）
     * @returns 取消注册的函数
     */
    onLanguageChange(_listener: () => void): () => void {
        // 中文单语版，不会触发语言切换
        return () => {};
    }

    /**
     * 解析键路径
     */
    private resolveKey(key: string): string {
        const value = this.getNestedValue(this.translationData, key);
        if (typeof value === "string") return value;

        // 键不存在，返回键路径本身
        this.logger?.warn("I18n", `翻译键不存在: ${key}`, { key });
        return key;
    }

    /**
     * 从嵌套对象中按点分隔路径取值
     */
    private getNestedValue(obj: unknown, path: string): unknown {
        const keys = path.split(".");
        let current: unknown = obj;
        for (const k of keys) {
            if (current && typeof current === "object" && k in (current as Record<string, unknown>)) {
                current = (current as Record<string, unknown>)[k];
            } else {
                return undefined;
            }
        }
        return current;
    }
}

/**
 * 格式化消息（支持 {param} 占位符插值）
 */
export function formatMessage(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return params[key]?.toString() ?? match;
    });
}

/**
 * 国际化（i18n）模块
 *
 * 功能：
 * - 从外部 JSON 文件加载翻译内容（构建时通过 esbuild JSON loader 内联）
 * - 支持 t(key) 键路径查找和 format(key, params) 占位符插值
 * - 翻译键缺失时回退到英文并通过 Logger 记录警告
 * - 语言切换时通知所有已注册的 UI 组件
 */

import zhLocale from "../locales/zh.json";
import enLocale from "../locales/en.json";
import type { ILogger } from "../types";

type Language = "zh" | "en";

/**
 * 翻译数据类型（嵌套 JSON 对象）
 */
type TranslationData = Record<string, unknown>;

/**
 * i18n 管理器
 *
 * 设计决策：构建时通过 esbuild JSON loader 内联翻译文件，
 * 避免运行时文件读取的异步复杂性，保证翻译文件始终与代码版本一致。
 */
export class I18n {
    private currentLanguage: Language;
    private readonly translationData: Record<Language, TranslationData>;
    private readonly listeners: Set<() => void> = new Set();
    private logger: ILogger | null = null;

    constructor(initialLanguage: Language = "zh") {
        this.currentLanguage = initialLanguage;
        this.translationData = {
            zh: zhLocale as TranslationData,
            en: enLocale as TranslationData,
        };
    }

    /**
     * 设置 Logger 实例（延迟注入，避免循环依赖）
     */
    setLogger(logger: ILogger): void {
        this.logger = logger;
    }

    /**
     * 获取当前语言
     */
    getLanguage(): Language {
        return this.currentLanguage;
    }

    /**
     * 设置语言，并通知所有已注册的监听器
     */
    setLanguage(language: Language): void {
        if (this.currentLanguage === language) return;
        this.currentLanguage = language;
        // 通知所有 UI 组件语言已切换
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                // 监听器异常不影响其他监听器
            }
        }
    }

    /**
     * 通过键路径获取翻译文本
     *
     * 支持两种调用方式：
     * - t("workbench.buttons.verify") → 返回对应翻译字符串
     * - t() → 返回当前语言的完整翻译对象（向后兼容）
     *
     * 键缺失时回退到英文；英文也缺失则返回键路径本身并记录警告。
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t(): any;
    t(key: string): string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t(key?: string): string | any {
        if (key === undefined) {
            // 向后兼容：返回完整翻译对象供属性访问
            return this.translationData[this.currentLanguage];
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
     * 注册语言切换监听器
     * @returns 取消注册的函数
     */
    onLanguageChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * 解析键路径，支持回退到英文
     */
    private resolveKey(key: string): string {
        // 先从当前语言查找
        const value = this.getNestedValue(this.translationData[this.currentLanguage], key);
        if (typeof value === "string") return value;

        // 当前语言缺失，回退到英文
        if (this.currentLanguage !== "en") {
            const fallback = this.getNestedValue(this.translationData.en, key);
            if (typeof fallback === "string") {
                this.logger?.warn("I18n", `翻译键缺失，已回退到英文: ${key}`, { key, lang: this.currentLanguage });
                return fallback;
            }
        }

        // 英文也缺失，返回键路径本身
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

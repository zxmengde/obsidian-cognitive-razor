/**
 * 国际化（i18n）模块 — 简化版（仅中文）
 *
 * 功能：
 * - 从 zh.json 加载翻译内容（构建时通过 esbuild JSON loader 内联）
 * - 支持 t(key) 键路径查找和 format(key, params) 占位符插值
 * - messages 提供需要批量读取的类型安全中文词条
 */

import zhLocale from "../locales/zh.json";
import type { ILogger } from "../types";

/**
 * 翻译数据类型（嵌套 JSON 对象）
 */
type TranslationData = typeof zhLocale;

/**
 * i18n 管理器（中文单语版）
 *
 * 插件只提供中文界面，不维护虚假的语言状态或切换事件。
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
    setLogger(logger: ILogger | null): void {
        this.logger = logger;
    }

    /** 供同一组件批量读取多个固定词条。 */
    get messages(): TranslationData {
        return this.translationData;
    }

    /**
     * 通过键路径获取翻译文本
     *
     * 例如 t("workbench.buttons.verify")。
     */
    t(key: string): string {
        return this.resolveKey(key);
    }

    /**
     * 带参数插值的翻译
     *
     * 支持 {param} 占位符，例如：
     *   format("confirmDialogs.deleteProvider.message", { id: "openai" })
     *   → "确定要删除 Provider \"openai\" 吗？此操作不可撤销。"
     */
    format(key: string, params: Record<string, string | number>): string {
        const template = this.resolveKey(key);
        return formatMessage(template, params);
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
function formatMessage(template: string, params: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
        return params[key]?.toString() ?? match;
    });
}

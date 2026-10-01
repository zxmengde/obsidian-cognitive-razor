import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(import.meta.dirname, "src"),
            // mock obsidian 模块，避免测试时解析失败
            obsidian: path.resolve(import.meta.dirname, "__mocks__/obsidian.ts"),
        },
    },
    test: {
        environment: "happy-dom",
    },
});

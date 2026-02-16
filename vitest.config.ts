import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
            // mock obsidian 模块，避免测试时解析失败
            obsidian: path.resolve(__dirname, "__mocks__/obsidian.ts"),
        },
    },
    test: {
        environment: "happy-dom",
    },
});

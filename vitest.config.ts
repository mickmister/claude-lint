import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        testTimeout: 5000, // 5 seconds
        hookTimeout: 5000,
    },
});

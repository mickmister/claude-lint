import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        testTimeout: 5000, // 5 seconds
        hookTimeout: 5000,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            include: ["src/**/*.ts"],
            exclude: [
                "src/**/*.test.ts",
                "src/**/*.spec.ts",
                "dist/**",
                "node_modules/**",
            ],
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70,
                statements: 70,
            },
        },
    },
});

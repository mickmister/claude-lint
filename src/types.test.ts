import { describe, it, expect } from "vitest";
import { defineLintConfig, definePresetFunction } from "./types.js";

describe("Type Helpers", () => {
  describe("defineLintConfig", () => {
    it("should return a valid lint config with defaults", () => {
      const config = defineLintConfig({
        validators: [
          {
            preset: "regex",
            scope: "changes-only",
            files: ["**/*.ts"],
            rules: [{
              name: "test-rule",
              patterns: ["test"],
              message: "Test message"
            }]
          }
        ]
      });

      expect(config.validators).toHaveLength(1);
      expect(config.verbose).toBe(false);
      expect(config.debug).toBe(false);
    });

    it("should allow overriding defaults", () => {
      const config = defineLintConfig({
        validators: [],
        verbose: true,
        debug: true
      });

      expect(config.verbose).toBe(true);
      expect(config.debug).toBe(true);
    });
  });

  describe("definePresetFunction", () => {
    it("should return the same function passed to it", () => {
      const mockPreset = async () => ({
        messages: [],
        errorCount: 0
      });

      const result = definePresetFunction(mockPreset);

      expect(result).toBe(mockPreset);
    });

    it("should work with a real preset function", async () => {
      const preset = definePresetFunction(async ({ changes }) => {
        const messages = [];
        let errorCount = 0;

        for (const change of changes) {
          if (change.snippet.includes("forbidden")) {
            messages.push({
              file: change.filePath,
              line: 1,
              column: 1,
              message: "Forbidden pattern found",
              ruleId: "test-rule"
            });
            errorCount++;
          }
        }

        return { messages, errorCount };
      });

      const result = await preset({
        changes: [
          {
            filePath: "test.ts",
            after: "const x = 'forbidden';",
            ranges: [{ start: 1, end: 1 }],
            snippet: "const x = 'forbidden';"
          }
        ],
        config: {
          preset: "test",
          scope: "changes-only",
          files: ["**/*.ts"],
          rules: []
        },
        sessionId: "test",
        cwd: "/test"
      });

      expect(result.errorCount).toBe(1);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].message).toBe("Forbidden pattern found");
    });
  });
});

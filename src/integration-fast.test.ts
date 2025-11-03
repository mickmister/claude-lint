import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {
    cmdRecord,
    cmdPreCache,
    cmdFinalize,
    resetSessionCache,
    setTestStdinData,
    setThrowOnExit,
    ExitCodeError,
} from "./cli.js";

const TEST_DIR = path.join(process.cwd(), ".test-temp-fast");
const SESSION_ID = "test-session";

describe("Fast CLI Integration Tests", () => {
    let originalCwd: string;

    beforeEach(async () => {
        originalCwd = process.cwd();

        await fs.mkdir(TEST_DIR, {recursive: true});
        process.chdir(TEST_DIR);

        resetSessionCache();
        setThrowOnExit(true);

        const payload = JSON.stringify({
            session_id: SESSION_ID,
            hook_event_name: "test",
            tool_name: "test",
        });
        setTestStdinData(payload);
    });

    afterEach(async () => {
        process.chdir(originalCwd);

        await fs.rm(TEST_DIR, {recursive: true, force: true});

        resetSessionCache();
    });

    describe("record command", () => {
        it("should record a file to journal", async () => {
            const testFile = "test.ts";
            await fs.writeFile(testFile, "const x = 1;");

            await cmdRecord({file: testFile});

            const journalPath = `.claude/cache/sessions/${SESSION_ID}/changed/changed_files.txt`;
            const content = await fs.readFile(journalPath, "utf8");
            expect(content).toContain(testFile);
        });

        it("should record all files (validators decide what to process)", async () => {
            const mdFile = "readme.md";
            await fs.writeFile(mdFile, "# Test");

            await cmdRecord({file: mdFile});

            const journalPath = `.claude/cache/sessions/${SESSION_ID}/changed/changed_files.txt`;
            const content = await fs.readFile(journalPath, "utf8");
            expect(content).toContain(mdFile);
        });
    });

    describe("pre-cache command", () => {
        it("should cache file content", async () => {
            const testFile = "test.ts";
            const content = "const x = 1;";
            await fs.writeFile(testFile, content);

            await cmdPreCache({file: testFile});

            const cachePath = `.claude/cache/sessions/${SESSION_ID}/pre/${testFile}.bak`;
            const cachedContent = await fs.readFile(cachePath, "utf8");
            expect(cachedContent).toBe(content);
        });
    });

    describe("finalize command", () => {
        beforeEach(async () => {
            await fs.writeFile("package.json", JSON.stringify({name: "test", type: "module"}));
            await fs.mkdir(".claude", {recursive: true});
        });

        it("should lint new files and exit with code 2 on errors", async () => {
            // Create config with regex validator
            const config = `module.exports = {
                validators: [{
                    preset: "regex",
                    scope: "changes-only",
                    files: ["**/*.js"],
                    rules: [{
                        name: "no-var",
                        severity: "error",
                        patterns: ["\\\\bvar\\\\s"],
                        message: "Use const or let instead of var"
                    }]
                }],
                maxWarnings: 0
            };`;
            await fs.writeFile(".claude/lint-config.js", config);

            const testFile = "test.js";
            await fs.writeFile(testFile, "var x = 1;\n");
            await cmdRecord({file: testFile});

            await expect(async () => {
                await cmdFinalize({});
            }).rejects.toThrow(ExitCodeError);

            try {
                await cmdFinalize({});
            } catch (err) {
                expect(err).toBeInstanceOf(ExitCodeError);
                expect((err as ExitCodeError).code).toBe(2);
            }
        });

        it("should pass when no violations", async () => {
            const config = `module.exports = {
                validators: [{
                    preset: "regex",
                    scope: "changes-only",
                    files: ["**/*.js"],
                    rules: [{
                        name: "no-var",
                        severity: "error",
                        patterns: ["\\\\bvar\\\\s"],
                        message: "Use const or let instead of var"
                    }]
                }],
                maxWarnings: 0
            };`;
            await fs.writeFile(".claude/lint-config.js", config);

            const testFile = "test.js";
            await fs.writeFile(testFile, "const x = 1;\n");
            await cmdRecord({file: testFile});

            await cmdFinalize({});
        });

        it("should only lint changed lines when pre-cache exists", async () => {
            const config = `module.exports = {
                validators: [{
                    preset: "regex",
                    scope: "changes-only",
                    files: ["**/*.js"],
                    rules: [{
                        name: "no-var",
                        severity: "error",
                        patterns: ["\\\\bvar\\\\s"],
                        message: "Use const or let instead of var"
                    }]
                }],
                maxWarnings: 0
            };`;
            await fs.writeFile(".claude/lint-config.js", config);

            const testFile = "test.js";
            const before = "const x = 1;\n";
            const after = "const x = 1;\nvar y = 2;\n";

            await fs.writeFile(testFile, before);
            await cmdPreCache({file: testFile});

            await fs.writeFile(testFile, after);
            await cmdRecord({file: testFile});

            await expect(async () => {
                await cmdFinalize({});
            }).rejects.toThrow(ExitCodeError);
        });
    });
});

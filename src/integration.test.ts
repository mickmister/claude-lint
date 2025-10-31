import {describe, it, expect, beforeEach, afterEach} from "vitest";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import {execSync} from "node:child_process";

const TEST_DIR = path.join(process.cwd(), ".test-temp");
const SESSION_ID = "default"; // CLI falls back to "default" session when no stdin
const JOURNAL = path.join(TEST_DIR, `.claude/cache/sessions/${SESSION_ID}/changed/changed_files.txt`);
const PRECACHE_ROOT = path.join(TEST_DIR, `.claude/cache/sessions/${SESSION_ID}/pre`);
const CLI_PATH = path.join(process.cwd(), "src/cli.ts");

describe("CLI Integration Tests", () => {
    beforeEach(async () => {
        // Create test directory
        await fs.mkdir(TEST_DIR, {recursive: true});
        process.chdir(TEST_DIR);
    });

    afterEach(async () => {
        // Clean up
        process.chdir(path.join(process.cwd(), ".."));
        await fs.rm(TEST_DIR, {recursive: true, force: true});
    });

    describe("record command", () => {
        it("should record a file to journal", async () => {
            const testFile = "test.ts";
            await fs.writeFile(testFile, "const x = 1;");

            execSync(`tsx ${CLI_PATH} record --file ${testFile}`, {encoding: "utf8"});

            const content = await fs.readFile(JOURNAL, "utf8");
            expect(content).toContain(testFile);
        });

        it("should only record web files", async () => {
            const mdFile = "readme.md";
            await fs.writeFile(mdFile, "# Test");

            execSync(`tsx ${CLI_PATH} record --file ${mdFile}`, {encoding: "utf8"});

            const journalExists = fssync.existsSync(JOURNAL);
            expect(journalExists).toBe(false);
        });

        it("should append multiple files to journal", async () => {
            await fs.writeFile("test1.ts", "const x = 1;");
            await fs.writeFile("test2.js", "const y = 2;");

            execSync(`tsx ${CLI_PATH} record --file test1.ts`, {encoding: "utf8"});
            execSync(`tsx ${CLI_PATH} record --file test2.js`, {encoding: "utf8"});

            const content = await fs.readFile(JOURNAL, "utf8");
            expect(content).toContain("test1.ts");
            expect(content).toContain("test2.js");
        });

        it("should parse file from stdin JSON", async () => {
            const testFile = "test.ts";
            await fs.writeFile(testFile, "const x = 1;");

            const payload = JSON.stringify({session_id: SESSION_ID, tool_input: {file_path: testFile}});
            execSync(`echo '${payload}' | tsx ${CLI_PATH} record`, {encoding: "utf8"});

            const content = await fs.readFile(JOURNAL, "utf8");
            expect(content).toContain(testFile);
        });
    });

    describe("pre-cache command", () => {
        it("should cache file content", async () => {
            const testFile = "test.ts";
            const content = "const x = 1;";
            await fs.writeFile(testFile, content);

            execSync(`tsx ${CLI_PATH} pre-cache --file ${testFile}`, {encoding: "utf8"});

            const cachePath = path.join(PRECACHE_ROOT, `${testFile}.bak`);
            const cachedContent = await fs.readFile(cachePath, "utf8");
            expect(cachedContent).toBe(content);
        });

        it("should not cache non-existent files", async () => {
            execSync(`tsx ${CLI_PATH} pre-cache --file nonexistent.ts`, {encoding: "utf8"});

            const cachePath = path.join(PRECACHE_ROOT, "nonexistent.ts.bak");
            const exists = fssync.existsSync(cachePath);
            expect(exists).toBe(false);
        });

        it("should not cache non-web files", async () => {
            const mdFile = "readme.md";
            await fs.writeFile(mdFile, "# Test");

            execSync(`tsx ${CLI_PATH} pre-cache --file ${mdFile}`, {encoding: "utf8"});

            const cachePath = path.join(PRECACHE_ROOT, `${mdFile}.bak`);
            const exists = fssync.existsSync(cachePath);
            expect(exists).toBe(false);
        });

        it("should parse file from stdin JSON", async () => {
            const testFile = "test.ts";
            const content = "const x = 1;";
            await fs.writeFile(testFile, content);

            const payload = JSON.stringify({session_id: SESSION_ID, tool_input: {file_path: testFile}});
            execSync(`echo '${payload}' | tsx ${CLI_PATH} pre-cache`, {encoding: "utf8"});

            const cachePath = path.join(PRECACHE_ROOT, `${testFile}.bak`);
            const cachedContent = await fs.readFile(cachePath, "utf8");
            expect(cachedContent).toBe(content);
        });
    });

    describe("clear command", () => {
        it("should clear journal and pre-cache", async () => {
            // Create journal and cache
            const testFile = "test.ts";
            await fs.writeFile(testFile, "const x = 1;");
            execSync(`tsx ${CLI_PATH} record --file ${testFile}`, {encoding: "utf8"});
            execSync(`tsx ${CLI_PATH} pre-cache --file ${testFile}`, {encoding: "utf8"});

            // Verify they exist
            expect(fssync.existsSync(JOURNAL)).toBe(true);
            expect(fssync.existsSync(PRECACHE_ROOT)).toBe(true);

            // Clear
            execSync(`tsx ${CLI_PATH} clear`, {encoding: "utf8"});

            // Verify journal is empty and pre-cache is deleted
            const journalContent = await fs.readFile(JOURNAL, "utf8");
            expect(journalContent).toBe("");
            expect(fssync.existsSync(PRECACHE_ROOT)).toBe(false);
        });
    });

    describe("finalize command", () => {
        beforeEach(async () => {
            // Create a minimal package.json to avoid issues
            await fs.writeFile("package.json", JSON.stringify({name: "test", type: "module"}));
        });

        it("should lint new files", async () => {
            const testFile = "test.js";
            await fs.writeFile(testFile, "var x = 1;\n");
            execSync(`tsx ${CLI_PATH} record --file ${testFile}`, {encoding: "utf8"});

            try {
                execSync(
                    `tsx ${CLI_PATH} finalize --no-eslintrc --rules "no-var:error"`,
                    {encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]}
                );
                throw new Error("Expected finalize to fail with errors");
            } catch (err: any) {
                const stderr = err.stderr?.toString() || "";
                expect(stderr).toContain("no-var");
                expect(err.status).toBe(2);
            }
        });

        it("should only lint changed lines when pre-cache exists", async () => {
            const testFile = "test.js";
            const before = "const x = 1;\n";
            const after = "const x = 1;\nvar y = 2;\n";

            await fs.writeFile(testFile, before);
            execSync(`tsx ${CLI_PATH} pre-cache --file ${testFile}`, {encoding: "utf8"});

            await fs.writeFile(testFile, after);
            execSync(`tsx ${CLI_PATH} record --file ${testFile}`, {encoding: "utf8"});

            try {
                execSync(
                    `tsx ${CLI_PATH} finalize --no-eslintrc --rules "no-var:error"`,
                    {encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]}
                );
                throw new Error("Expected finalize to fail with errors");
            } catch (err: any) {
                const stderr = err.stderr?.toString() || "";
                // Should find error in added line
                expect(stderr).toContain("no-var");
                expect(err.status).toBe(2);
            }
        });

        it("should clear journal when --clear-journal is set", async () => {
            const testFile = "test.js";
            await fs.writeFile(testFile, "const x = 1;\n");
            execSync(`tsx ${CLI_PATH} record --file ${testFile}`, {encoding: "utf8"});
            execSync(`tsx ${CLI_PATH} pre-cache --file ${testFile}`, {encoding: "utf8"});

            expect(fssync.existsSync(JOURNAL)).toBe(true);

            const result = execSync(
                `tsx ${CLI_PATH} finalize --no-eslintrc --clear-journal 2>&1`,
                {encoding: "utf8"}
            );

            expect(result).toContain("All checks passed");
            expect(fssync.existsSync(JOURNAL)).toBe(false);
            expect(fssync.existsSync(PRECACHE_ROOT)).toBe(false);
        });

        it("should load config from file", async () => {
            const testFile = "test.js";
            await fs.writeFile(testFile, "var x = 1;\n");
            execSync(`tsx ${CLI_PATH} record --file ${testFile}`, {encoding: "utf8"});

            const config = {
                noEslintrc: true,
                rules: {"no-var": "error"},
            };
            await fs.writeFile("lint-config.json", JSON.stringify(config));

            try {
                execSync(
                    `tsx ${CLI_PATH} finalize --config lint-config.json`,
                    {encoding: "utf8", stdio: ["pipe", "pipe", "pipe"]}
                );
                throw new Error("Expected finalize to fail with errors");
            } catch (err: any) {
                const stderr = err.stderr?.toString() || "";
                expect(stderr).toContain("no-var");
                expect(err.status).toBe(2);
            }
        });

        it("should handle no files gracefully", async () => {
            const result = execSync(`tsx ${CLI_PATH} finalize --no-eslintrc --verbose`, {
                encoding: "utf8",
                stdio: ["pipe", "pipe", "pipe"],
            });

            expect(result).toContain("No files to lint");
        });
    });
});

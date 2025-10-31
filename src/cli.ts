#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import process from "node:process";
import {diffLines} from "diff";
import {ESLint} from "eslint";
import {createRequire} from "node:module";

const require = createRequire(import.meta.url);

// Debug logging to file - writes to session-specific or startup log
function debugLog(message: string, sessionId: string | null) {
    try {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] ${message}\n`;
        const logFile = sessionId
            ? `.claude/logs/${sessionId}.log`
            : `.claude/logs/startup.log`;
        fssync.mkdirSync(path.dirname(logFile), {recursive: true});
        fssync.appendFileSync(logFile, logMessage);
    } catch (err) {
        // Silently fail if we can't write debug logs
    }
}

// Session-aware cache paths
// Reads session ID from stdin JSON payload (provided by Claude Code hooks)
// These caches ensure stdin is only read once and the session ID is reused
let CACHED_SESSION_ID: string | null = null;
let CACHED_STDIN_DATA: string | null = null; // Cache stdin data since it can only be read once

async function getSessionId(): Promise<string> {
    if (CACHED_SESSION_ID) {
        debugLog(`getSessionId: returning cached session_id: ${CACHED_SESSION_ID}`, CACHED_SESSION_ID);
        return CACHED_SESSION_ID;
    }

    // Read session_id from stdin JSON (hook payload from Claude Code)
    if (!process.stdin.isTTY) {
        try {
            const stdinData = await readStdin();
            CACHED_STDIN_DATA = stdinData; // Cache for reuse in command functions
            debugLog(`getSessionId: read stdin data (length: ${stdinData.length})`, CACHED_SESSION_ID);
            if (stdinData) {
                const payload = JSON.parse(stdinData);
                // Log only essential fields, not the entire payload
                const payloadSummary = {
                    session_id: payload.session_id,
                    hook_event_name: payload.hook_event_name,
                    tool_name: payload.tool_name,
                    file_path: payload.tool_input?.file_path
                };
                debugLog(`getSessionId: parsed stdin payload: ${JSON.stringify(payloadSummary)}`, CACHED_SESSION_ID);
                if (payload.session_id) {
                    CACHED_SESSION_ID = payload.session_id;
                    // Debug: Print the session ID when it's first cached
                    console.error('DEBUG LOG: ' + CACHED_SESSION_ID);
                    debugLog(`getSessionId: cached session_id from stdin: ${CACHED_SESSION_ID}`, CACHED_SESSION_ID);
                    return CACHED_SESSION_ID!;
                }
            }
        } catch (err) {
            debugLog(`getSessionId: failed to read session_id from stdin: ${err instanceof Error ? err.message : err}`, CACHED_SESSION_ID);
            // stdin not valid JSON or doesn't contain session_id
            throw new Error("Failed to read session_id from stdin. Are you running this from Claude Code hooks?");
        }
    }

    // No stdin (running manually), use "default" session
    CACHED_SESSION_ID = "default";
    debugLog(`getSessionId: using default session_id: ${CACHED_SESSION_ID}`, CACHED_SESSION_ID);
    return CACHED_SESSION_ID;
}

function getSessionPaths(sessionId: string) {
    const base = `.claude/cache/sessions/${sessionId}`;
    return {
        journal: `${base}/changed/changed_files.txt`,
        precache: `${base}/pre`,
        cache: base,
    };
}

type Config = {
    noEslintrc?: boolean;
    rules?: RulesRecord;
    typeAware?: boolean;
    maxWarnings?: number;
    clearJournal?: boolean;
    verbose?: boolean;
    ruleGuidance?: Record<string, string>;
}

type RulesRecord = NonNullable<NonNullable<NonNullable<ConstructorParameters<typeof ESLint>[0]>['overrideConfig']>['rules']>;
type RuleEntry = RulesRecord[string];

export type Flags = Record<string, string | boolean>;
export function parseArgs(argv: string[]) {
    const [, , sub = "help", ...rest] = argv;
    const flags: Flags = {};
    const positional: string[] = [];
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a.startsWith("--")) {
            const [k, v] = a.replace(/^--/, "").split("=", 2);
            if (v !== undefined) {
                flags[k] = v;
            } else if (i + 1 < rest.length && !rest[i + 1].startsWith("--")) {
                // Next arg is the value for this flag
                flags[k] = rest[i + 1];
                i++; // Skip the next arg
            } else {
                flags[k] = true;
            }
        } else {
            positional.push(a);
        }
    }
    return {sub, flags, positional};
}

let VERBOSE = false;
function log(...args: unknown[]) {
    if (VERBOSE) console.log(...args);
}
function logError(...args: unknown[]) {
    console.error(...args);
}

// For testing: allow injecting stdin data instead of reading from process.stdin
let INJECTED_STDIN_DATA: string | null = null;

async function readStdin(): Promise<string> {
    if (INJECTED_STDIN_DATA !== null) {
        return INJECTED_STDIN_DATA;
    }

    if (process.stdin.isTTY) return "";
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString("utf8");
}

export function isWebFile(p: string) {return /\.(?:[jt]s|[jt]sx)$/.test(p);}
export function virtFromReal(p: string) {
    if (p.endsWith(".tsx")) return "snippet.tsx";
    if (p.endsWith(".ts")) return "snippet.ts";
    if (p.endsWith(".jsx")) return "snippet.jsx";
    return "snippet.js";
}
export function uniq<T>(xs: T[]) {return Array.from(new Set(xs));}
function ensureDirFor(filePath: string) {
    fssync.mkdirSync(path.dirname(filePath), {recursive: true});
}
export function parseRulesCsv(csv?: string) {
    const out: RulesRecord = {};
    if (!csv) return out;

    // Split by commas, but be careful with JSON arrays
    const specs: string[] = [];
    let current = "";
    let depth = 0;
    let inString = false;

    for (let i = 0; i < csv.length; i++) {
        const char = csv[i];
        if (char === '"' && (i === 0 || csv[i - 1] !== '\\')) {
            inString = !inString;
        }
        if (!inString) {
            if (char === '[' || char === '{') depth++;
            if (char === ']' || char === '}') depth--;
        }
        if (char === ',' && depth === 0 && !inString) {
            specs.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    if (current.trim()) specs.push(current.trim());

    for (const spec of specs) {
        const s = spec.trim(); if (!s) continue;
        const i = s.indexOf(":"); if (i <= 0) continue;
        const id = s.slice(0, i).trim();
        const valueRaw = s.slice(i + 1).trim();

        // Try to parse as JSON first (for array/object configs)
        let value: RuleEntry;
        try {
            value = JSON.parse(valueRaw);
        } catch {
            // Fall back to simple string parsing
            const lvlRaw = valueRaw.toLowerCase() as NonNullable<RuleEntry>;
            value = lvlRaw === "error" ? 2 : lvlRaw === "warn" ? 1 : Number.isFinite(+lvlRaw) ? (+lvlRaw as RuleEntry) : (valueRaw as RuleEntry);
        }
        out[id] = value;
    }
    return out;
}

function buildESLint(cwd: string, realFile: string, virt: string, opts: {
    noEslintrc?: boolean;
    rules?: RulesRecord;
    typeAware?: boolean;
}) {
    const baseRules = opts.rules || {};
    const isTS = /\.tsx?$/.test(realFile) || /\.tsx?$/.test(virt);

    let parserOptions: Record<string, string> | undefined = undefined;
    if (opts.typeAware) {
        const tsconfigPath = path.join(cwd, "tsconfig.json");
        if (fssync.existsSync(tsconfigPath)) {
            try {
                JSON.parse(fssync.readFileSync(tsconfigPath, "utf8"));
                parserOptions = {project: "tsconfig.json"};
                log("Using type-aware linting with tsconfig.json");
            } catch (err) {
                logError(`Warning: tsconfig.json exists but is invalid JSON: ${err instanceof Error ? err.message : err}`);
                logError("Falling back to non-type-aware linting");
            }
        } else {
            log("Type-aware linting requested but tsconfig.json not found");
        }
    }

    const overrideConfig = opts.noEslintrc ? {
        env: {
            es2022: true,
            node: true,
        },
        parserOptions: {
            ecmaVersion: 2022 as const,
            sourceType: "module" as const,
            ...(isTS && parserOptions ? parserOptions : {}),
        },
        parser: isTS ? require.resolve("@typescript-eslint/parser") : undefined,
        plugins: isTS ? ["@typescript-eslint", "no-comments"] : ["no-comments"],
        rules: baseRules,
    } : undefined;

    return new ESLint({
        useEslintrc: !opts.noEslintrc,
        resolvePluginsRelativeTo: cwd,
        overrideConfig,
        ignore: !opts.noEslintrc
    });
}

export type Range = {start: number; end: number};
export function computeAdded(before: string, after: string) {
    const parts = diffLines(before, after);
    const ranges: Range[] = [];
    let afterLine = 1;
    const snippetPieces: string[] = [];
    for (const p of parts) {
        const lines = p.value.split(/\r?\n/);
        const count = lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
        if (p.added) {
            const s = afterLine, e = afterLine + count - 1;
            if (count > 0) {
                ranges.push({start: s, end: e});
                snippetPieces.push(p.value.replace(/\r?\n$/, ""));
            }
            afterLine += count;
        } else if (p.removed) {
            // no advance
        } else {
            afterLine += count;
        }
    }
    return {ranges, snippet: snippetPieces.join("\n")};
}
export function inRanges(line: number, ranges: Range[]) {
    return ranges.some(r => line >= r.start && line <= r.end);
}

let SHOULD_THROW_ON_EXIT = false;

export class ExitCodeError extends Error {
    constructor(public code: number) {
        super(`Process would exit with code ${code}`);
        this.name = "ExitCodeError";
    }
}

export function resetSessionCache() {
    CACHED_SESSION_ID = null;
    CACHED_STDIN_DATA = null;
    INJECTED_STDIN_DATA = null;
    SHOULD_THROW_ON_EXIT = false;
}

export function setTestStdinData(data: string) {
    INJECTED_STDIN_DATA = data;
}

export function setThrowOnExit(shouldThrow: boolean) {
    SHOULD_THROW_ON_EXIT = shouldThrow;
}

function exit(code: number): never {
    if (SHOULD_THROW_ON_EXIT) {
        throw new ExitCodeError(code);
    }
    process.exit(code);
}

export async function cmdRecord(flags: Flags) {
    const sessionId = await getSessionId();
    const paths = getSessionPaths(sessionId);

    let file = (flags.file as string) || "";
    if (!file) {
        const raw = CACHED_STDIN_DATA || "";
        try {
            file = JSON.parse(raw)?.tool_input?.file_path ?? "";
        } catch (err) {
            logError(`Failed to parse stdin JSON: ${err instanceof Error ? err.message : err}`);
            return;
        }
    }
    if (!file || !isWebFile(file)) {
        log(`Skipping file (not a web file): ${file || "(empty)"}`);
        return;
    }
    log(`Recording file: ${file}${sessionId ? ` (session: ${sessionId})` : ""}`);
    ensureDirFor(paths.journal);
    await fs.appendFile(paths.journal, file + "\n");
}

export async function cmdPreCache(flags: Flags) {
    const sessionId = await getSessionId();
    const paths = getSessionPaths(sessionId);

    let file = (flags.file as string) || "";
    if (!file) {
        const raw = CACHED_STDIN_DATA || "";
        try {
            file = JSON.parse(raw)?.tool_input?.file_path ?? "";
        } catch (err) {
            logError(`Failed to parse stdin JSON: ${err instanceof Error ? err.message : err}`);
            return;
        }
    }
    if (!file || !isWebFile(file)) {
        log(`Skipping file (not a web file): ${file || "(empty)"}`);
        return;
    }
    if (!fssync.existsSync(file)) {
        log(`Skipping file (does not exist): ${file}`);
        return;
    }
    log(`Pre-caching file: ${file}${sessionId ? ` (session: ${sessionId})` : ""}`);
    const cachePath = path.join(paths.precache, `${file}.bak`);
    ensureDirFor(cachePath);
    await fs.copyFile(file, cachePath);
}

export async function cmdFinalize(flags: Flags) {
    const sessionId = await getSessionId();
    const paths = getSessionPaths(sessionId);

    let config: Config = {};

    const configFile = (flags.config as string) || "";
    if (configFile && fssync.existsSync(configFile)) {
        try {
            const configData = JSON.parse(await fs.readFile(configFile, "utf8"));
            config = configData;
            log(`Loaded config from ${configFile}`);
        } catch (err) {
            logError(`Failed to load config file: ${err instanceof Error ? err.message : err}`);
        }
    }

    // Command-line flags override config file
    const noEslintrc = flags["no-eslintrc"] !== undefined ? !!flags["no-eslintrc"] : (config.noEslintrc ?? false);
    const rulesCsv = (flags.rules as string) || "";
    const typeAware = flags["type-aware"] !== undefined ? !!flags["type-aware"] : (config.typeAware ?? false);
    const maxWarnings = flags["max-warnings"] !== undefined ? Number(flags["max-warnings"]) : (config.maxWarnings ?? 0);
    const clearJournal = flags["clear-journal"] !== undefined ? !!flags["clear-journal"] : (config.clearJournal ?? false);
    const guidanceFile = (flags.guidance as string) || "";

    // Use rules from config if not provided via CSV
    const baseRules = rulesCsv ? parseRulesCsv(rulesCsv) : (config.rules || {});

    let files: string[] = [];
    try {
        const txt = await fs.readFile(paths.journal, "utf8");
        files = uniq(txt.split("\n").map(s => s.trim()).filter(Boolean).filter(isWebFile));
    } catch (err) {
        log(`No journal file found or unable to read: ${err instanceof Error ? err.message : err}`);
    }

    if (files.length === 0) {
        log("No files to lint");
        return;
    }

    let ruleGuidance: Record<string, string> = config.ruleGuidance || {};
    if (guidanceFile && fssync.existsSync(guidanceFile)) {
        try {
            const guidanceData = JSON.parse(await fs.readFile(guidanceFile, "utf8"));
            ruleGuidance = {...ruleGuidance, ...(guidanceData.ruleOutputs || guidanceData)};
            log(`Loaded guidance from ${guidanceFile}`);
        } catch (err) {
            logError(`Failed to load guidance file: ${err instanceof Error ? err.message : err}`);
        }
    }

    log(`Linting ${files.length} file(s)...`);
    let totalErrs = 0, totalWarns = 0;
    let filesProcessed = 0;
    const ruleCounts: Record<string, number> = {};

    for (const file of files) {
        filesProcessed++;
        log(`[${filesProcessed}/${files.length}] Processing: ${file}`);
        const beforePath = path.join(paths.precache, `${file}.bak`);
        const hasBefore = fssync.existsSync(beforePath);
        const afterExists = fssync.existsSync(file);
        if (!afterExists) {
            log(`  Skipping (file deleted): ${file}`);
            continue;
        }

        const cwd = process.cwd();
        const virt = virtFromReal(file);
        const eslint = buildESLint(cwd, file, virt, {noEslintrc, rules: baseRules, typeAware});

        if (hasBefore) {
            const [before, after] = await Promise.all([fs.readFile(beforePath, "utf8"), fs.readFile(file, "utf8")]);
            const {ranges, snippet} = computeAdded(before, after);
            log(`  Found ${ranges.length} changed range(s)`);

            // 1) Try snippet-only lint
            if (snippet.trim() !== "") {
                try {
                    log(`  Attempting snippet-only lint...`);
                    const res = await eslint.lintText(snippet, {filePath: virt});
                    const errs = res.reduce((n: number, r) => n + (r.errorCount || 0), 0);
                    const warns = res.reduce((n: number, r) => n + (r.warningCount || 0), 0);
                    const hasParsing = res.some((r) => r.messages.some((m) => /Parsing error/i.test(m.message)));
                    if (!hasParsing && (errs > 0 || warns > 0)) {
                        log(`  Snippet lint succeeded: ${errs} error(s), ${warns} warning(s)`);
                        for (const r of res) for (const m of r.messages) {
                            console.error(`${file}:${m.line ?? 0}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "unknown"})`);
                            const ruleId = m.ruleId ?? "unknown";
                            ruleCounts[ruleId] = (ruleCounts[ruleId] || 0) + 1;
                        }
                        totalErrs += errs; totalWarns += warns;
                        continue;
                    }
                    log(`  Snippet lint had parsing errors or no issues, falling back to full-file lint`);
                } catch (err) {
                    log(`  Snippet lint failed: ${err instanceof Error ? err.message : err}, falling back to full-file lint`);
                }
            } else {
                log(`  Snippet is empty, skipping to full-file lint`);
            }

            // 2) Fallback: full-file lint filtered by changed lines
            log(`  Running full-file lint (filtered to changed lines)...`);
            const full = await eslint.lintFiles([file]);
            let fileErrs = 0, fileWarns = 0;
            for (const r of full) for (const m of r.messages) {
                const line = m.line ?? 0;
                if (line && inRanges(line, ranges)) {
                    console.error(`${r.filePath}:${line}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "unknown"})`);
                    const ruleId = m.ruleId ?? "unknown";
                    ruleCounts[ruleId] = (ruleCounts[ruleId] || 0) + 1;
                    if (m.severity === 2) { totalErrs++; fileErrs++; }
                    else if (m.severity === 1) { totalWarns++; fileWarns++; }
                }
            }
            log(`  Full-file lint completed: ${fileErrs} error(s), ${fileWarns} warning(s) in changed lines`);
        } else {
            // New file: no baseline, lint full file
            log(`  New file (no pre-cache), linting entire file...`);
            const res = await eslint.lintFiles([file]);
            let fileErrs = 0, fileWarns = 0;
            for (const r of res) for (const m of r.messages) {
                console.error(`${r.filePath}:${m.line ?? 0}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "unknown"})`);
                const ruleId = m.ruleId ?? "unknown";
                ruleCounts[ruleId] = (ruleCounts[ruleId] || 0) + 1;
                if (m.severity === 2) { totalErrs++; fileErrs++; }
                else if (m.severity === 1) { totalWarns++; fileWarns++; }
            }
            log(`  Full-file lint completed: ${fileErrs} error(s), ${fileWarns} warning(s)`);
        }
    }

    // Summary
    console.error(`\nLinted ${filesProcessed} file(s): ${totalErrs} error(s), ${totalWarns} warning(s)`);

    // Rule summary with guidance
    const sortedRules = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]);
    if (sortedRules.length > 0) {
        console.error(`\nRule Summary and Guidance:`);
        for (const [ruleId, count] of sortedRules) {
            console.error(`  ${count.toString().padStart(4)}  ${ruleId}`);
            debugLog(`  ${count.toString().padStart(4)}  ${ruleId}`, sessionId);

            if (ruleGuidance[ruleId]) {
                console.error(`\n${ruleGuidance[ruleId]}\n`);
                debugLog(`\n${ruleGuidance[ruleId]}\n`, sessionId);
            }
        }
    }

    if (totalErrs > 0) {
        console.error(`To Claude: Please clean up ${totalErrs} error(s)`);
        debugLog(`❌ Failed due to ${totalErrs} error(s)`, sessionId);
    } else if (totalWarns > maxWarnings) {
        console.error(`To Claude: Please clean up ${totalWarns} warning(s) exceeds max-warnings threshold of ${maxWarnings}`);
        debugLog(`❌ Failed: ${totalWarns} warning(s) exceeds max-warnings threshold of ${maxWarnings}`, sessionId);
    } else {
        console.error(`✅ All checks passed`);
        debugLog(`✅ All checks passed`, sessionId);
    }

    if (clearJournal) {
        log("Clearing journal and pre-cache...");
        try {
            await fs.writeFile(paths.journal, "");
            log("Journal cleared");
        } catch (err) {
            logError(`Failed to clear journal: ${err instanceof Error ? err.message : err}`);
        }
        try {
            await fs.rm(paths.precache, { recursive: true, force: true });
            log("Pre-cache cleared");
        } catch (err) {
            logError(`Failed to clear pre-cache: ${err instanceof Error ? err.message : err}`);
        }
    }

    log(`Cleaning up cache directory${sessionId ? ` for session ${sessionId}` : ""}...`);
    try {
        await fs.rm(paths.cache, { recursive: true, force: true });
        log("Cache directory cleaned up");
    } catch (err) {
        logError(`Failed to clean up cache directory: ${err instanceof Error ? err.message : err}`);
    }

    if (totalErrs > 0) exit(2);
    if (totalWarns > maxWarnings) exit(2);
}

(async () => {
    const {sub, flags} = parseArgs(process.argv);
    VERBOSE = !!flags.verbose;

    const sessionId = await getSessionId();

    debugLog(`========== Session initialized ==========`, sessionId);
    debugLog(`Session ID: ${sessionId}`, sessionId);
    debugLog(`Command: ${sub}`, sessionId);
    debugLog(`Flags: ${JSON.stringify(flags)}`, sessionId);
    debugLog(`CWD: ${process.cwd()}`, sessionId);

    log(`Session ID: ${sessionId}`);
    log(`CLAUDE_SESSION_ID env: ${process.env.CLAUDE_SESSION_ID || "(not set)"}`);
    log(`Process PID: ${process.pid}`);

    switch (sub) {
        case "record": await cmdRecord(flags); return;
        case "pre-cache": await cmdPreCache(flags); return;
        case "finalize": await cmdFinalize(flags); return;
        case "clear": {
            const sessionId = await getSessionId();
            const paths = getSessionPaths(sessionId);
            log(`Clearing journal and pre-cache${sessionId ? ` for session ${sessionId}` : ""}...`);
            try {
                await fs.writeFile(paths.journal, "");
                await fs.rm(paths.precache, { recursive: true, force: true });
                console.log("✅ Journal and pre-cache cleared");
            } catch (err) {
                logError(`Failed to clear: ${err instanceof Error ? err.message : err}`);
            }
            return;
        }
        case "clear-all": {
            log("Clearing all sessions...");
            try {
                await fs.rm(".claude/cache", { recursive: true, force: true });
                console.log("✅ All sessions and caches cleared");
            } catch (err: unknown) {
                logError(`Failed to clear all: ${err instanceof Error ? err.message : err}`);
            }
            return;
        }
        default:
            console.log(`claude-lint

Usage:
  claude-lint record [--file path] [--verbose]
      # Record a file change (or read Claude hook payload from stdin)

  claude-lint pre-cache [--file path] [--verbose]
      # Cache the pre-edit version of a file

  claude-lint finalize [options]
      Options:
        --config <path>       Load configuration from JSON file
        --no-eslintrc         Use inline config instead of .eslintrc
        --rules "<csv>"       Comma-separated rules (e.g., "no-var:error,semi:warn")
        --type-aware          Enable TypeScript type-aware linting (requires tsconfig.json)
        --max-warnings N      Fail if warnings exceed N (default: 0)
        --clear-journal       Clear journal and pre-cache after linting
        --guidance <path>     JSON file with rule guidance messages (format: {"ruleOutputs": {"rule-id": "message"}})
        --verbose             Show detailed progress information
      Note: Command-line flags override config file settings

  claude-lint clear [--verbose]
      # Clear the journal and pre-cache for current session

  claude-lint clear-all [--verbose]
      # Clear ALL session caches (useful for cleanup)

Session Management:
  Sessions are automatically isolated to prevent cache confusion.
  - Set CLAUDE_SESSION_ID environment variable for custom session IDs
  - Falls back to process PID for automatic isolation
  - Caches stored in .claude/cache/sessions/<session-id>/

Exit codes:
  0 - Success
  1 - Uncaught error
  2 - Lint errors found or warnings exceed threshold
`);
    }
})().catch(e => {console.error(e?.stack || e); exit(1);});

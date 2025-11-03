#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import process from "node:process";
import { regexValidator } from "./presets/regex.preset.js";
import { filePatternValidator } from "./presets/file-pattern.preset.js";
import { computeAdded, matchesGlob, uniq } from "./utils.js";
import type { LintConfig, FileChange, LintMessage, ValidatorConfig, PresetFunction } from "./types.js";

// Global flag to control debug logging (set after config is loaded)
let DEBUG_ENABLED = false;

// Debug logging to file - writes to session-specific or startup log
function debugLog(message: string, sessionId: string | null) {
    if (!DEBUG_ENABLED) {
        return;
    }
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

function ensureDirFor(filePath: string) {
    fssync.mkdirSync(path.dirname(filePath), {recursive: true});
}

export type Range = {start: number; end: number};

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

// Preset loader - maps preset name to function
const BUILTIN_PRESETS: Record<string, PresetFunction> = {
    "regex": regexValidator,
    "file-pattern": filePatternValidator
};

async function loadPreset(presetPath: string): Promise<PresetFunction> {
    // Built-in preset
    if (BUILTIN_PRESETS[presetPath]) {
        return BUILTIN_PRESETS[presetPath];
    }

    // Custom preset (file path)
    if (presetPath.startsWith("./") || presetPath.startsWith("/")) {
        const imported = await import(path.resolve(presetPath));
        return imported.default || imported.validator;
    }

    throw new Error(`Unknown preset: ${presetPath}`);
}

// Run all validators and aggregate results
async function runValidators(
    validators: ValidatorConfig[],
    changes: FileChange[],
    sessionId: string,
    cwd: string
): Promise<{ messages: LintMessage[], errorCount: number, warningCount: number }> {
    const allMessages: LintMessage[] = [];
    let totalErrors = 0;
    let totalWarnings = 0;

    for (const validator of validators) {
        const preset = await loadPreset(validator.preset);
        const result = await preset({ changes, config: validator, sessionId, cwd });

        allMessages.push(...result.messages);
        totalErrors += result.errorCount;
        totalWarnings += result.warningCount;
    }

    return {
        messages: allMessages,
        errorCount: totalErrors,
        warningCount: totalWarnings
    };
}

// Load file changes from journal
async function loadFileChanges(files: string[], sessionId: string): Promise<FileChange[]> {
    const paths = getSessionPaths(sessionId);
    const changes: FileChange[] = [];

    for (const file of files) {
        const beforePath = path.join(paths.precache, `${file}.bak`);
        const hasBefore = fssync.existsSync(beforePath);
        const afterExists = fssync.existsSync(file);

        if (!afterExists) {
            log(`Skipping (file deleted): ${file}`);
            continue;
        }

        const after = await fs.readFile(file, "utf8");

        if (hasBefore) {
            const before = await fs.readFile(beforePath, "utf8");
            const { ranges, snippet } = computeAdded(before, after);

            changes.push({
                filePath: file,
                before,
                after,
                ranges,
                snippet
            });
        } else {
            // New file - entire file is "changed"
            changes.push({
                filePath: file,
                after,
                ranges: [{ start: 1, end: after.split('\n').length }],
                snippet: after
            });
        }
    }

    return changes;
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
    if (!file) {
        log(`Skipping file (empty file path)`);
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
    if (!file) {
        log(`Skipping file (empty file path)`);
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

    // 1. Load config
    const configFile = (flags.config as string) || ".claude/lint-config.js";
    let config: LintConfig;

    try {
        if (configFile.endsWith('.js') || configFile.endsWith('.mjs')) {
            // Dynamic import for .js/.mjs config (ESM)
            const configModule = await import(path.resolve(configFile));
            config = configModule.default || configModule;
        } else {
            // JSON config (legacy)
            const configData = JSON.parse(await fs.readFile(configFile, "utf8"));
            config = configData;
        }
        log(`Loaded config from ${configFile}`);
    } catch (err) {
        logError(`Failed to load config file: ${err instanceof Error ? err.message : err}`);
        logError(`Using empty config`);
        config = { validators: [], maxWarnings: 0, clearJournal: false, verbose: false };
    }

    // Enable debug logging if configured
    DEBUG_ENABLED = config.debug ?? false;

    // 2. Read journal and load file changes
    let files: string[] = [];
    try {
        const txt = await fs.readFile(paths.journal, "utf8");
        files = uniq(txt.split("\n").map(s => s.trim()).filter(Boolean));
    } catch (err) {
        log(`No journal file found or unable to read: ${err instanceof Error ? err.message : err}`);
    }

    if (files.length === 0) {
        log("No files to lint");
        return;
    }

    log(`Loading ${files.length} file(s)...`);
    const changes = await loadFileChanges(files, sessionId);

    if (changes.length === 0) {
        log("No changes to lint");
        return;
    }

    // 3. Run validators
    log(`Running validators...`);
    const result = await runValidators(config.validators, changes, sessionId, process.cwd());

    // 4. Display results
    for (const msg of result.messages) {
        console.error(`${msg.file}:${msg.line}:${msg.column}  ${msg.message}  (${msg.ruleId})`);
    }

    // 5. Summary
    const maxWarnings = flags["max-warnings"] !== undefined ? Number(flags["max-warnings"]) : (config.maxWarnings ?? 0);
    const clearJournal = flags["clear-journal"] !== undefined ? !!flags["clear-journal"] : (config.clearJournal ?? false);

    console.error(`\nLinted ${changes.length} file(s): ${result.errorCount} error(s), ${result.warningCount} warning(s)`);

    // 6. Exit codes
    if (result.errorCount > 0) {
        console.error(`To Claude: Please clean up ${result.errorCount} error(s)`);
        debugLog(`❌ Failed due to ${result.errorCount} error(s)`, sessionId);
    } else if (result.warningCount > maxWarnings) {
        console.error(`To Claude: Please clean up ${result.warningCount} warning(s) exceeds max-warnings threshold of ${maxWarnings}`);
        debugLog(`❌ Failed: ${result.warningCount} warning(s) exceeds max-warnings threshold of ${maxWarnings}`, sessionId);
    } else {
        console.error(`✅ All checks passed`);
        debugLog(`✅ All checks passed`, sessionId);
    }

    // 7. Cleanup
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

    if (result.errorCount > 0) exit(2);
    if (result.warningCount > maxWarnings) exit(2);
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

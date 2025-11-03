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
import defaultConfig from "./lint-config.default.mjs";

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
            ? `.claude/.claude-lint/logs/${sessionId}.log`
            : `.claude/.claude-lint/logs/startup.log`;
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
    const base = `.claude/.claude-lint/sessions/${sessionId}`;
    return {
        journal: `${base}/changed/changed_files.txt`,
        precache: `${base}/pre`,
        cache: base,
    };
}

export type Flags = Record<string, string | boolean>;
export function parseArgs(argv: string[]) {
    const [, , subOrFlag = "help", ...rest] = argv;
    const flags: Flags = {};
    const positional: string[] = [];

    // If the "subcommand" starts with --, it's actually a flag
    let sub = subOrFlag;
    let args = rest;
    if (subOrFlag.startsWith("--")) {
        sub = "help"; // No subcommand provided
        args = [subOrFlag, ...rest];
    }

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith("--")) {
            const [k, v] = a.replace(/^--/, "").split("=", 2);
            if (v !== undefined) {
                flags[k] = v;
            } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                // Next arg is the value for this flag
                flags[k] = args[i + 1];
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
): Promise<{ messages: LintMessage[], errorCount: number }> {
    const allMessages: LintMessage[] = [];
    let totalErrors = 0;

    for (const validator of validators) {
        const preset = await loadPreset(validator.preset);
        const result = await preset({ changes, config: validator, sessionId, cwd });

        allMessages.push(...result.messages);
        totalErrors += result.errorCount;
    }

    return {
        messages: allMessages,
        errorCount: totalErrors
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
            const { ranges, snippet, addedRanges, modifiedRanges } = computeAdded(before, after);

            changes.push({
                filePath: file,
                before,
                after,
                ranges,
                snippet,
                addedRanges,
                modifiedRanges
            });
        } else {
            // New file - entire file is "changed" (all pure additions)
            const allLines = { start: 1, end: after.split('\n').length };
            changes.push({
                filePath: file,
                after,
                ranges: [allLines],
                snippet: after,
                addedRanges: [allLines],
                modifiedRanges: []
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

export async function cmdInit() {
    const settingsPath = ".claude/settings.json";
    const lintConfigPath = ".claude/lint-config.mjs";

    // Hook configuration to be added
    const hooksConfig = {
        hooks: {
            PreToolUse: [
                {
                    matcher: "Edit|Write",
                    hooks: [
                        {
                            type: "command",
                            command: "npx claude-lint"
                        }
                    ]
                }
            ],
            PostToolUse: [
                {
                    matcher: "Edit|Write",
                    hooks: [
                        {
                            type: "command",
                            command: "npx claude-lint"
                        }
                    ]
                }
            ],
            Stop: [
                {
                    hooks: [
                        {
                            type: "command",
                            command: "npx claude-lint"
                        }
                    ]
                }
            ]
        }
    };

    // Default lint config content
    const lintConfigContent = `import { defineLintConfig } from 'claude-lint';
import defaultConfig from 'claude-lint/lint-config.default.mjs';

export default defineLintConfig({
  validators: [
    ...defaultConfig.validators,
    // Add your custom validators here
  ]
});
`;

    // Check if settings.json exists
    const settingsExists = fssync.existsSync(settingsPath);

    if (settingsExists) {
        // Load existing settings and merge
        try {
            const existingContent = await fs.readFile(settingsPath, "utf8");
            const existingSettings = JSON.parse(existingContent);

            // Deep merge hooks configuration
            if (!existingSettings.hooks) {
                existingSettings.hooks = hooksConfig.hooks;
            } else {
                // Merge each hook type
                for (const hookType of ["PreToolUse", "PostToolUse", "Stop"] as const) {
                    if (!existingSettings.hooks[hookType]) {
                        existingSettings.hooks[hookType] = hooksConfig.hooks[hookType];
                    } else {
                        // Check if claude-lint hook already exists
                        const hasClaudeLint = existingSettings.hooks[hookType].some((hookConfig: any) => {
                            return hookConfig.hooks?.some((h: any) =>
                                h.command?.includes("claude-lint")
                            );
                        });

                        if (!hasClaudeLint) {
                            // Add our hook configuration
                            existingSettings.hooks[hookType].push(...hooksConfig.hooks[hookType]);
                        } else {
                            console.log(`⚠️  ${hookType} hook for claude-lint already exists, skipping`);
                        }
                    }
                }
            }

            // Write merged settings
            ensureDirFor(settingsPath);
            await fs.writeFile(settingsPath, JSON.stringify(existingSettings, null, 2) + "\n");
            console.log(`✅ Updated ${settingsPath} with claude-lint hooks`);
        } catch (err) {
            logError(`Failed to merge settings: ${err instanceof Error ? err.message : err}`);
            exit(1);
        }
    } else {
        // Create new settings.json
        ensureDirFor(settingsPath);
        await fs.writeFile(settingsPath, JSON.stringify(hooksConfig, null, 2) + "\n");
        console.log(`✅ Created ${settingsPath} with claude-lint hooks`);
    }

    // Create lint config if it doesn't exist
    if (!fssync.existsSync(lintConfigPath)) {
        ensureDirFor(lintConfigPath);
        await fs.writeFile(lintConfigPath, lintConfigContent);
        console.log(`✅ Created ${lintConfigPath} (extends default config)`);
    } else {
        console.log(`⚠️  ${lintConfigPath} already exists, skipping`);
    }

    console.log(`\nNext steps:
  1. Customize .claude/lint-config.mjs as needed
  2. See documentation: https://github.com/mickmister/claude-lint
`);
}

export async function cmdFinalize(flags: Flags) {
    const sessionId = await getSessionId();
    const paths = getSessionPaths(sessionId);

    // 1. Load config
    // Try multiple config file locations in order
    const configCandidates = [
        flags.config as string,
        ".claude/lint-config.mjs",
        ".claude/lint-config.js",
        ".claude/lint-config.json"
    ].filter(Boolean);

    let config: LintConfig | null = null;
    let configFile: string | null = null;

    for (const candidate of configCandidates) {
        try {
            if (candidate.endsWith('.js') || candidate.endsWith('.mjs')) {
                // Dynamic import for .js/.mjs config (ESM)
                const configModule = await import(path.resolve(candidate));
                config = configModule.default || configModule;
            } else {
                // JSON config (legacy)
                const configData = JSON.parse(await fs.readFile(candidate, "utf8"));
                config = configData;
            }
            configFile = candidate;
            log(`Loaded config from ${configFile}`);
            break;
        } catch (err) {
            // Try next candidate
            continue;
        }
    }

    if (!config) {
        log(`No config file found. Tried: ${configCandidates.join(', ')}`);
        log(`Using default config`);
        config = defaultConfig;
        configFile = "(default)";
    }

    // Enable debug logging if configured
    DEBUG_ENABLED = config?.debug ?? false;

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

    log(`Loading ${plural(files.length, 'file')}...`);
    const changes = await loadFileChanges(files, sessionId);

    if (changes.length === 0) {
        log("No changes to lint");
        return;
    }

    // 3. Run validators
    log(`Running validators...`);
    const result = await runValidators(config!.validators, changes, sessionId, process.cwd());

    // 4. Display results
    for (const msg of result.messages) {
        console.error(`${msg.file}:${msg.line}:${msg.column}  ${msg.message}  (${msg.ruleId})`);
    }

    // 5. Summary
    console.error(`\nLinted ${plural(changes.length, 'file')}: ${plural(result.errorCount, 'error')}`);

    // 6. Exit codes
    if (result.errorCount > 0) {
        console.error(`To Claude: Please clean up ${plural(result.errorCount, 'error')}`);
        debugLog(`❌ Failed due to ${plural(result.errorCount, 'error')}`, sessionId);
    } else {
        console.error(`✅ All checks passed`);
        debugLog(`✅ All checks passed`, sessionId);
    }

    // 7. Cleanup - always clear journal and precache after finalize
    log("Cleaning up session data...");
    try {
        await fs.rm(paths.journal, { force: true });
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

    if (result.errorCount > 0) exit(2);
}

(async () => {
    const {sub, flags} = parseArgs(process.argv);
    VERBOSE = !!flags.verbose;

    const sessionId = await getSessionId();

    // Auto-detect hook from stdin if no subcommand provided
    let hookEventName: string | null = null;
    if (!sub || sub === "help") {
        try {
            const stdinData = CACHED_STDIN_DATA || "";
            if (stdinData) {
                const payload = JSON.parse(stdinData);
                hookEventName = payload.hook_event_name;
            }
        } catch (err) {
            // Ignore parsing errors, will fall through to help
        }
    }

    debugLog(`========== Session initialized ==========`, sessionId);
    debugLog(`Session ID: ${sessionId}`, sessionId);
    debugLog(`Command: ${sub}`, sessionId);
    debugLog(`Hook Event: ${hookEventName}`, sessionId);
    debugLog(`Flags: ${JSON.stringify(flags)}`, sessionId);
    debugLog(`CWD: ${process.cwd()}`, sessionId);

    log(`Session ID: ${sessionId}`);
    log(`CLAUDE_SESSION_ID env: ${process.env.CLAUDE_SESSION_ID || "(not set)"}`);
    log(`Process PID: ${process.pid}`);

    // Route based on hook event name if detected, otherwise use subcommand
    const command = hookEventName || sub;

    switch (command) {
        case "init":
            await cmdInit();
            return;
        case "PreToolUse":
        case "pre-cache":
            await cmdPreCache(flags);
            return;
        case "PostToolUse":
        case "record":
            await cmdRecord(flags);
            return;
        case "Stop":
        case "finalize":
            await cmdFinalize(flags);
            return;
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
                await fs.rm(".claude/.claude-lint/sessions", { recursive: true, force: true });
                console.log("✅ All sessions cleared");
            } catch (err: unknown) {
                logError(`Failed to clear all: ${err instanceof Error ? err.message : err}`);
            }
            return;
        }
        default:
            console.log(`claude-lint

A multi-validator linting tool for Claude Code hooks.

Usage:
  # Setup:
  claude-lint init
      Initialize Claude Code hooks in .claude/settings.json
      Merges with existing settings if file already exists

  # Hook integration (auto-detects from stdin):
  claude-lint [options]
      Automatically detects PreToolUse/PostToolUse/Stop hook from stdin payload.
      Use this in your .claude/settings.json hooks configuration.

  # Manual commands (for testing):
  claude-lint pre-cache [--file path] [--verbose]
  claude-lint record [--file path] [--verbose]
  claude-lint finalize [--config path] [--verbose]

  # Utility commands:
  claude-lint clear         # Clear current session cache
  claude-lint clear-all     # Clear all session caches

Options:
  --config <path>       Config file path (default: .claude/lint-config.js)
  --verbose             Show detailed progress
  --file <path>         File path (for manual pre-cache/record)

Configuration:
  Create .claude/lint-config.mjs or .claude/lint-config.js:
    import { defineLintConfig } from 'claude-lint';

    export default defineLintConfig({
      validators: [
        {
          preset: "regex",
          scope: "changes-only",
          files: ["**/*.ts"],
          rules: [...]
        }
      ]
    });

Session Management:
  Sessions are automatically isolated to prevent cache confusion.
  - Set CLAUDE_SESSION_ID environment variable for custom session IDs
  - Falls back to process PID for automatic isolation
  - Caches stored in .claude/.claude-lint/sessions/<session-id>/

Exit codes:
  0 - Success
  1 - Uncaught error
  2 - Lint errors found
`);
    }
})().catch(e => {
    const errorMessage = e?.stack || e;
    console.error(errorMessage);

    // Write unexpected errors to log file so user can see what went wrong
    try {
        const errorLog = '.claude/.claude-lint/error.log';
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] Unexpected error:\n${errorMessage}\n\n`;
        fssync.mkdirSync(path.dirname(errorLog), {recursive: true});
        fssync.writeFileSync(errorLog, logMessage);
        console.error(`\nError details written to ${errorLog}`);
    } catch (logErr) {
        // Silently fail if we can't write error log
    }

    exit(1);
});

function plural(count: number, singular: string, plural?: string): string {
    return `${count} ${count === 1 ? singular : (plural || `${singular}s`)}`;
}

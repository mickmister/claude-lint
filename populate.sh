#!/usr/bin/env bash
set -euo pipefail

# ---- settings you can tweak ----
PKG_NAME="claude-lint-changes"
PKG_DESC="Claude Code hooks helper: journal changed files and lint on Stop (snippet→fallback)."
AUTHOR_NAME="Your Name"
AUTHOR_EMAIL="you@example.com"
LICENSE="MIT"
NODE_VERSION="${NODE_VERSION:-">=18.18"}"
# --------------------------------

mkdir -p "$PKG_NAME"/{bin,src,.claude/cache/pre,.claude/cache/changed}
cd "$PKG_NAME"

# ---------- package.json ----------
cat > package.json <<'JSON'
{
  "name": "__PKG_NAME__",
  "version": "0.1.0",
  "description": "__PKG_DESC__",
  "type": "module",
  "bin": {
    "claude-lint-changes": "dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "dev": "tsx bin/cli.ts",
    "build": "tsc -p tsconfig.json",
    "prepare": "pnpm run build"
  },
  "engines": { "node": "__NODE_VERSION__" },
  "license": "__LICENSE__",
  "author": "__AUTHOR_NAME__ <__AUTHOR_EMAIL__>"
}
JSON

tmpfile="$(mktemp)"
sed -e "s/__PKG_NAME__/$PKG_NAME/g" \
    -e "s/__PKG_DESC__/$PKG_DESC/g" \
    -e "s/__AUTHOR_NAME__/$AUTHOR_NAME/g" \
    -e "s/__AUTHOR_EMAIL__/$AUTHOR_EMAIL/g" \
    -e "s/__LICENSE__/$LICENSE/g" \
    -e "s|__NODE_VERSION__|$NODE_VERSION|g" \
    package.json > "$tmpfile"
mv "$tmpfile" package.json

# ---------- tsconfig.json ----------
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["bin/**/*.ts", "src/**/*.ts"]
}
JSON

# ---------- .gitignore ----------
cat > .gitignore <<'EOF'
node_modules
dist
pnpm-lock.yaml
.DS_Store
.claude/cache/*
!/.claude/cache/.gitkeep
EOF
touch .claude/cache/.gitkeep .claude/cache/pre/.gitkeep .claude/cache/changed/.gitkeep

# ---------- bin/cli.ts (the CLI) ----------
cat > bin/cli.ts <<'TS'
#!/usr/bin/env node
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import process from "node:process";
import { diffLines } from "diff";
import { ESLint } from "eslint";
import tsPlugin from "@typescript-eslint/eslint-plugin";

const JOURNAL = ".claude/cache/changed/changed_files.txt";
const PRECACHE_ROOT = ".claude/cache/pre";

type Flags = Record<string, string | boolean>;
function parseArgs(argv: string[]) {
  const [, , sub = "help", ...rest] = argv;
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const [k, v] = a.replace(/^--/, "").split("=", 2);
      flags[k] = v ?? true;
    } else {
      positional.push(a);
    }
  }
  return { sub, flags, positional };
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

function isWebFile(p: string) { return /\.(?:[jt]s|[jt]sx)$/.test(p); }
function virtFromReal(p: string) {
  if (p.endsWith(".tsx")) return "snippet.tsx";
  if (p.endsWith(".ts")) return "snippet.ts";
  if (p.endsWith(".jsx")) return "snippet.jsx";
  return "snippet.js";
}
function uniq<T>(xs: T[]) { return Array.from(new Set(xs)); }
function ensureDirFor(filePath: string) {
  fssync.mkdirSync(path.dirname(filePath), { recursive: true });
}
function parseRulesCsv(csv?: string) {
  const out: Record<string, any> = {};
  if (!csv) return out;
  for (const spec of csv.split(",")) {
    const s = spec.trim(); if (!s) continue;
    const i = s.lastIndexOf(":"); if (i <= 0) continue;
    const id = s.slice(0, i).trim();
    const lvlRaw = s.slice(i + 1).trim().toLowerCase();
    const lvl = lvlRaw === "error" ? 2 : lvlRaw === "warn" ? 1 : Number.isFinite(+lvlRaw) ? +lvlRaw : lvlRaw;
    out[id] = lvl;
  }
  return out;
}

function buildESLint(cwd: string, realFile: string, virt: string, opts: {
  noEslintrc?: boolean;
  rulesCsv?: string;
  typeAware?: boolean;
}) {
  const baseRules = parseRulesCsv(opts.rulesCsv);
  const isTS = /\.tsx?$/.test(realFile) || /\.tsx?$/.test(virt);
  const overrideConfig = opts.noEslintrc ? {
    rules: baseRules,
    overrides: isTS ? [{
      files: ["**/*.ts", "**/*.tsx", virt],
      parser: require.resolve("@typescript-eslint/parser"),
      plugins: { "@typescript-eslint": tsPlugin as any },
      parserOptions: (opts.typeAware && fssync.existsSync(path.join(cwd, "tsconfig.json")))
        ? { project: "tsconfig.json" } : undefined,
    }] : undefined
  } : undefined;

  return new ESLint({
    useEslintrc: !opts.noEslintrc,
    resolvePluginsRelativeTo: cwd,
    overrideConfig,
    ignore: !opts.noEslintrc
  });
}

type Range = { start: number; end: number };
function computeAdded(before: string, after: string) {
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
        ranges.push({ start: s, end: e });
        snippetPieces.push(p.value.replace(/\r?\n$/, ""));
      }
      afterLine += count;
    } else if (p.removed) {
      // no advance
    } else {
      afterLine += count;
    }
  }
  return { ranges, snippet: snippetPieces.join("\n") };
}
function inRanges(line: number, ranges: Range[]) {
  return ranges.some(r => line >= r.start && line <= r.end);
}

// ----- subcommands -----
async function cmdRecord(flags: Flags) {
  let file = (flags.file as string) || "";
  if (!file) {
    const raw = await readStdin();
    try { file = JSON.parse(raw)?.tool_input?.file_path ?? ""; } catch {}
  }
  if (!file || !isWebFile(file)) return;
  ensureDirFor(JOURNAL);
  await fs.appendFile(JOURNAL, file + "\n");
}

async function cmdPreCache(flags: Flags) {
  let file = (flags.file as string) || "";
  if (!file) {
    const raw = await readStdin();
    try { file = JSON.parse(raw)?.tool_input?.file_path ?? ""; } catch {}
  }
  if (!file || !isWebFile(file) || !fssync.existsSync(file)) return;
  const cachePath = path.join(PRECACHE_ROOT, `${file}.bak`);
  ensureDirFor(cachePath);
  await fs.copyFile(file, cachePath);
}

async function cmdFinalize(flags: Flags) {
  const noEslintrc = !!flags["no-eslintrc"];
  const rulesCsv = (flags.rules as string) || "";
  const typeAware = !!flags["type-aware"];
  const maxWarnings = Number(flags["max-warnings"] ?? 0);
  const clearJournal = !!flags["clear-journal"];

  let files: string[] = [];
  try {
    const txt = await fs.readFile(JOURNAL, "utf8");
    files = uniq(txt.split("\n").map(s => s.trim()).filter(Boolean).filter(isWebFile));
  } catch {}

  if (files.length === 0) return;

  let totalErrs = 0, totalWarns = 0;

  for (const file of files) {
    const beforePath = path.join(PRECACHE_ROOT, `${file}.bak`);
    const hasBefore = fssync.existsSync(beforePath);
    const afterExists = fssync.existsSync(file);
    if (!afterExists) continue;

    const cwd = process.cwd();
    const virt = virtFromReal(file);
    const eslint = buildESLint(cwd, file, virt, { noEslintrc, rulesCsv, typeAware });

    if (hasBefore) {
      const [before, after] = await Promise.all([fs.readFile(beforePath, "utf8"), fs.readFile(file, "utf8")]);
      const { ranges, snippet } = computeAdded(before, after);

      // 1) Try snippet-only lint
      if (snippet.trim() !== "") {
        try {
          const res = await eslint.lintText(snippet, { filePath: virt });
          const errs = res.reduce((n, r) => n + (r.errorCount || 0), 0);
          const warns = res.reduce((n, r) => n + (r.warningCount || 0), 0);
          const hasParsing = res.some(r => r.messages.some(m => /Parsing error/i.test(m.message)));
          if (!hasParsing && (errs > 0 || warns > 0)) {
            for (const r of res) for (const m of r.messages) {
              console.log(`${file}:${m.line ?? 0}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "unknown"})`);
            }
            totalErrs += errs; totalWarns += warns;
            continue;
          }
        } catch {
          // parser error -> fall back
        }
      }

      // 2) Fallback: full-file lint filtered by changed lines
      const full = await eslint.lintFiles([file]);
      for (const r of full) for (const m of r.messages) {
        const line = m.line ?? 0;
        if (line && inRanges(line, ranges)) {
          console.log(`${r.filePath}:${line}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "unknown"})`);
          if (m.severity === 2) totalErrs++; else if (m.severity === 1) totalWarns++;
        }
      }
    } else {
      // New file: no baseline, lint full file
      const res = await eslint.lintFiles([file]);
      for (const r of res) for (const m of r.messages) {
        console.log(`${r.filePath}:${m.line ?? 0}:${m.column ?? 0}  ${m.message}  (${m.ruleId ?? "unknown"})`);
        if (m.severity === 2) totalErrs++; else if (m.severity === 1) totalWarns++;
      }
    }
  }

  if (clearJournal) {
    try { await fs.writeFile(JOURNAL, ""); } catch {}
    // Optionally: purge pre-cache tree
    // await fs.rm(PRECACHE_ROOT, { recursive: true, force: true });
  }

  if (totalErrs > 0) process.exit(2);
  if (totalWarns > maxWarnings) process.exit(2);
}

(async () => {
  const { sub, flags } = parseArgs(process.argv);
  switch (sub) {
    case "record":     await cmdRecord(flags); return;
    case "pre-cache":  await cmdPreCache(flags); return;
    case "finalize":   await cmdFinalize(flags); return;
    case "clear":
      try { await fs.writeFile(JOURNAL, ""); } catch {}
      return;
    default:
      console.log(`claude-lint-changes

Usage:
  claude-lint-changes record [--file path]        # or read Claude hook payload (JSON) from stdin
  claude-lint-changes pre-cache [--file path]     # idem
  claude-lint-changes finalize [--no-eslintrc] [--rules "<csv>"] [--type-aware] [--max-warnings N] [--clear-journal]
  claude-lint-changes clear
`);
  }
})().catch(e => { console.error(e?.stack || e); process.exit(1); });
TS

# ---------- install deps with pnpm (no hardcoded versions) ----------
pnpm add -D tsx @types/node
pnpm add eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin diff typescript

# ---------- build & make executable ----------
pnpm run build
chmod +x dist/cli.js

echo "Scaffold complete in: $(pwd)
Next:
  pnpm dev -- help
  # Example local try:
  node dist/cli.js record --file src/example.ts
  node dist/cli.js pre-cache --file src/example.ts
  node dist/cli.js finalize --no-eslintrc --rules '@typescript-eslint/no-explicit-any:error,no-var:error' --type-aware --max-warnings 0
"

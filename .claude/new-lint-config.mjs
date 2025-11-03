import {defineLintConfig} from '../dist';

export default defineLintConfig({
  validators: [
    {
      preset: "regex",
      scope: "changes-only",
      files: ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}"],
      exclude: ["**/*-lint-config.js"],
      rules: [
        {
          name: "no-todos",
          severity: "error",
          patterns: [
            "\\b[Tt][Oo][Dd][Oo]\\b",
            "\\b[Ff][Ii][Xx][Mm][Ee]\\b",
            "\\b[Hh][Aa][Cc][Kk]\\b"
          ],
          message: `TODO/FIXME/HACK comments not allowed:
- If you're blocked on the issue, please be super clear about this in your response.
- Otherwise please implement this here.`,
        },
        // {
        //   name: "no-console-log",
        //   severity: "warning",
        //   patterns: ["console\\.log\\("],
        //   message: "Remove console.log statements before committing"
        // },
        {
          name: "explicit-any",
          severity: "error",
          patterns: [
            ": any(?=[,\\s\\)\\}\\]\\|;]|$)",
            "as any(?=[,\\s\\)\\}\\]\\|;]|$)"
          ],
          message: `Explicit 'any' types are not allowed:
- Prefer natural type inference when possible
- Provide proper types or use 'unknown'.
- If you're blocked on the issue, please be super clear about this in your response.`,
        },
        {
          name: "no-comments",
          severity: "error",
          patterns: [
            "^\\s*//(?!\\s*tip:).*$",
            "^\\s*/\\*(?!.*tip:).*\\*/$"
          ],
          message: `Comments are not allowed (except those starting with "tip:").

→ If the comment is meant to explain that you met the requirements of my ask, then simply remove the comment.
→ If the comment is providing clarity for the code and truly increases readability, leave a "tip:" at the beginning of the line of code.`
        }
      ]
    },

    // Regex validator: package.json dependency enforcement
    {
      preset: "regex",
      scope: "changes-only",
      files: ["**/package.json"],
      rules: [
        {
          name: "no-manual-package-json-deps",
          severity: "error",
          patterns: [
            "^\\s*\"[@a-zA-Z0-9._/-]+\"\\s*:\\s*\"[^\"]+\"\\s*,?\\s*$"
          ],
          message: `Do not manually add dependencies to package.json.

→ Run: npm install <package> or pnpm add <package>
→ For dev dependencies: npm install -D <package> or pnpm add -D <package>
→ This ensures package-lock.json / pnpm-lock.yaml stays in sync`
        }
      ]
    },

    // File-pattern validator: File organization rules
    {
      preset: "file-pattern",
      scope: "whole-file",
      files: ["**/*.[mM][dD]"],
      rules: [
        {
          name: "markdown-organization",
          severity: "error",
          patterns: ["**/*.md"],
          allowed: [
            "(?i)**/CLAUDE\\.md",
            "(?i)**/README\\.md",
            "claude_notes/\\d+-.*\\.md"
          ],
          message: `Markdown files (except CLAUDE.md/README.md) must be in claude_notes/ with numeric prefix.

→ Move file to: claude_notes/NNN-descriptive-name.md
→ Use format: claude_notes/001-feature-name.md, claude_notes/002-bug-fix.md, etc.`
        }
      ]
    }

    // TODO: ESLint validator (not yet implemented)
    // {
    //   preset: "eslint",
    //   scope: "changes-only",
    //   files: ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}"],
    //   rules: [
    //     {
    //       name: "@typescript-eslint/no-unused-vars",
    //       config: ["error", {argsIgnorePattern: "^_"}]
    //     },
    //     {
    //       name: "no-debugger",
    //       config: "error"
    //     },
    //     {
    //       name: "no-console",
    //       config: ["warn", {allow: ["warn", "error"]}]
    //     }
    //   ],
    //   options: {
    //     typeAware: false,
    //     noEslintrc: false
    //   }
    // }
  ],

  maxWarnings: 0,
  clearJournal: true,
  verbose: true,
  debug: true
});

import {defineLintConfig} from 'claude-lint';

// not included by default
export const noCommentsRule = {
  name: "no-comments",
  patterns: [
    "^\\s*//(?!\\s*important:).*$",
    "^\\s*/\\*(?!.*important:).*\\*/$"
  ],
  message: `Comments are not allowed (except those starting with "important:").

→ If the comment is meant to explain that you met the requirements of my ask, then simply remove the comment.
→ If the comment is providing clarity for the code and truly increases readability, leave an "important:" at the beginning of the line of code.`
};

export const noCommentsRuleBash = {
  name: "no-comments-bash",
  patterns: [
    "^\\s*#(?!\\s*important:).*$",  // Line-starting comments
    "(?<=\\S)\\s+#(?!\\s*important:).*$"  // Inline comments (after non-whitespace)
  ],
  message: `Comments are not allowed (except those starting with "important:").

→ If the comment is meant to explain that you met the requirements of my ask, then simply remove the comment.
→ If the comment is providing clarity for the code and truly increases readability, leave an "important:" at the beginning of the line of code.`
};

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
          patterns: [
            "\\b[Tt][Oo][Dd][Oo]\\b",
            "\\b[Ff][Ii][Xx][Mm][Ee]\\b",
            "\\b[Hh][Aa][Cc][Kk]\\b"
          ],
          message: `TODO/FIXME/HACK comments not allowed:
- If you're blocked on the issue, please be super clear about this in your response.
- Otherwise please implement this here.`,
        },
        {
          name: "explicit-any",
          patterns: [
            ": any(?=[,\\s\\)\\}\\]\\|;]|$)",
            "as any(?=[,\\s\\)\\}\\]\\|;]|$)"
          ],
          message: `Explicit 'any' types are not allowed:
- Prefer natural type inference when possible
- Provide proper types or use 'unknown'.
- If you're blocked on the issue, please be super clear about this in your response.`,
        },
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
          patterns: ["**/*.md"],
          allowed: [
            "(?i)**/CLAUDE\\.md",
            "(?i)**/README\\.md",
            "claude_notes/\\d+-.*\\.md"
          ],
          message: `Markdown files (except CLAUDE.md/README.md) must be in claude_notes/ with numeric prefix.

→ Move file to: claude_notes/NNN-descriptive-name.md
→ Use format: claude_notes/001-feature-name.md, claude_notes/002-bug-fix.md, etc.
- Prefer mv over rewriting the whole file.`
        }
      ]
    }
  ],
});

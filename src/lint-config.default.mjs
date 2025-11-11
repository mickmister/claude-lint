import {defineLintConfig} from 'claude-lint';

export function noEmojisValidator(options = {}) {
  const files = options.files || ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}"];

  return {
    preset: "regex",
    scope: "changes-only",
    files,
    rules: [
      {
        name: "no-emojis",
        patterns: [
          "[\\uD83C-\\uDBFF][\\uDC00-\\uDFFF]", // Surrogate pairs (most emojis)
          "[\\u2600-\\u26FF]",                   // Misc symbols
          "[\\u2700-\\u27BF]"                    // Dingbats
        ],
        message: options.message || `Emojis are not allowed in code:
- Use descriptive text instead of emojis
- Keep code professional and text-based`,
      }
    ]
  };
}

export function noCommentsValidator(options = {}) {
  const allowedKeywords = options.allowedKeywords || ['important:'];
  const files = options.files || ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts}"];

  // Build negative lookahead patterns for each keyword
  const lineCommentPatterns = allowedKeywords.map(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^\\s*//(?!\\s*${escaped}).*$`;
  });

  const blockCommentPatterns = allowedKeywords.map(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^\\s*/\\*(?!.*${escaped}).*\\*/$`;
  });

  return {
    preset: "regex",
    scope: "changes-only",
    files,
    rules: [
      {
        name: "no-comments",
        patterns: [
          ...lineCommentPatterns,
          ...blockCommentPatterns
        ],
        message: options.message || `Comments are not allowed (except those starting with: ${allowedKeywords.join(', ')}).

→ If the comment is meant to explain that you met the requirements of my ask, then simply remove the comment.
→ If the comment is providing clarity for the code and truly increases readability, use one of the allowed keywords: ${allowedKeywords.join(', ')}`
      }
    ]
  };
}

export function noCommentsValidatorBash(options = {}) {
  const allowedKeywords = options.allowedKeywords || ['important:'];
  const files = options.files || ["**/*.sh", "**/*.bash"];

  // Build negative lookahead patterns for each keyword
  const lineStartPatterns = allowedKeywords.map(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^\\s*#(?!\\s*${escaped}).*$`;
  });

  const inlinePatterns = allowedKeywords.map(kw => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `(?<=\\S)\\s+#(?!\\s*${escaped}).*$`;
  });

  return {
    preset: "regex",
    scope: "changes-only",
    files,
    rules: [
      {
        name: "no-comments-bash",
        patterns: [
          ...lineStartPatterns,
          ...inlinePatterns
        ],
        message: options.message || `Comments are not allowed (except those starting with: ${allowedKeywords.join(', ')}).

→ If the comment is meant to explain that you met the requirements of my ask, then simply remove the comment.
→ If the comment is providing clarity for the code and truly increases readability, use one of the allowed keywords: ${allowedKeywords.join(', ')}`
      }
    ]
  };
}

export function noTodosValidator(options = {}) {
  const files = options.files || ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}"];
  const exclude = options.exclude || ["**/*-lint-config.js"];

  return {
    preset: "regex",
    scope: "changes-only",
    files,
    exclude,
    rules: [
      {
        name: "no-todos",
        patterns: [
          "\\b[Tt][Oo][Dd][Oo]\\b",
          "\\b[Ff][Ii][Xx][Mm][Ee]\\b",
          "\\b[Hh][Aa][Cc][Kk]\\b"
        ],
        message: options.message || `TODO/FIXME/HACK comments not allowed:
- If you're blocked on the issue, please be super clear about this in your response.
- Otherwise please implement this here.`,
      }
    ]
  };
}

export function noExplicitAnyValidator(options = {}) {
  const files = options.files || ["**/*.{js,jsx,ts,tsx,cjs,mjs,cts,mts,md}"];
  const exclude = options.exclude || ["**/*-lint-config.js"];

  return {
    preset: "regex",
    scope: "changes-only",
    files,
    exclude,
    rules: [
      {
        name: "explicit-any",
        patterns: [
          ": any(?=[,\\s\\)\\}\\]\\|;]|$)",
          "as any(?=[,\\s\\)\\}\\]\\|;]|$)"
        ],
        message: options.message || `Explicit 'any' types are not allowed:
- Prefer natural type inference when possible
- Provide proper types or use 'unknown'.
- If you're blocked on the issue, please be super clear about this in your response.`,
      }
    ]
  };
}

export function noManualPackageJsonValidator(options = {}) {
  const files = options.files || ["**/package.json"];

  return {
    preset: "regex",
    scope: "changes-only",
    files,
    rules: [
      {
        name: "no-manual-package-json-deps",
        patterns: [
          "^\\s*\"[@a-zA-Z0-9._/-]+\"\\s*:\\s*\"[^\"]+\"\\s*,?\\s*$"
        ],
        message: options.message || `Do not manually add dependencies to package.json.

→ Run: npm install <package> or pnpm add <package>
→ For dev dependencies: npm install -D <package> or pnpm add -D <package>
→ This ensures package-lock.json / pnpm-lock.yaml stays in sync`
      }
    ]
  };
}

export function markdownOrganizationValidator(options = {}) {
  const files = options.files || ["**/*.[mM][dD]"];
  const allowed = options.allowed || [
    "**/CLAUDE.md",
    "**/CLAUDE.MD",
    "**/claude.md",
    "**/claude.MD",
    "**/README.md",
    "**/README.MD",
    "**/readme.md",
    "**/readme.MD",
    "claude_notes/\\d+-.*\\.md",
    "claude_notes/\\d+-.*\\.MD"
  ];

  return {
    preset: "file-pattern",
    scope: "whole-file",
    files,
    rules: [
      {
        name: "markdown-organization",
        patterns: ["**/*.md", "**/*.MD"],
        allowed,
        message: options.message || `Markdown files (except CLAUDE.md/README.md) must be in claude_notes/ with numeric prefix.

→ Move file to: claude_notes/NNN-descriptive-name.md
→ Use format: claude_notes/001-feature-name.md, claude_notes/002-bug-fix.md, etc.
- Prefer mv over rewriting the whole file.`
      }
    ]
  };
}

export const extraValidators = [
  noEmojisValidator(),
  noCommentsValidator(),
  noCommentsValidatorBash(),
];

export default defineLintConfig({
  validators: [
    noTodosValidator(),
    noExplicitAnyValidator(),
    noManualPackageJsonValidator(),
    markdownOrganizationValidator(),
  ],
});

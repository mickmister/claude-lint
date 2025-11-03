import { describe, it, expect } from 'vitest';
import { filePatternValidator } from './file-pattern.preset.js';
import type { PresetContext, FileChange } from '../types.js';

describe('filePatternValidator', () => {
  it('should allow files matching allowed patterns', async () => {
    const changes: FileChange[] = [{
      filePath: 'claude_notes/001-feature.md',
      after: '# Feature',
      ranges: [],
      snippet: ''
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        rules: [{
          name: 'markdown-organization',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: [
            '**/CLAUDE.md',
            '**/README.md',
            'claude_notes/\\d+-.*\\.md'
          ],
          message: 'Markdown files must be in claude_notes/'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(0);
    expect(result.errorCount).toBe(0);
  });

  it('should report files not matching any allowed pattern', async () => {
    const changes: FileChange[] = [{
      filePath: 'docs/guide.md',
      after: '# Guide',
      ranges: [],
      snippet: ''
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        rules: [{
          name: 'markdown-organization',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: [
            '**/CLAUDE.md',
            '**/README.md',
            'claude_notes/\\d+-.*\\.md'
          ],
          message: 'Markdown files must be in claude_notes/'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      file: 'docs/guide.md',
      line: 1,
      column: 1,
      ruleId: 'markdown-organization',
      message: 'Markdown files must be in claude_notes/'
    });
    expect(result.errorCount).toBe(1);
  });

  it('should match case-insensitive glob patterns', async () => {
    const changes: FileChange[] = [
      {
        filePath: 'CLAUDE.md',
        after: '# CLAUDE',
        ranges: [],
        snippet: ''
      },
      {
        filePath: 'src/README.md',
        after: '# README',
        ranges: [],
        snippet: ''
      }
    ];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.[mM][dD]'],
        rules: [{
          name: 'markdown-organization',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: [
            '**/CLAUDE.md',
            '**/README.md'
          ],
          message: 'Only CLAUDE.md and README.md allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(0);
  });

  it('should match regex patterns in allowed list', async () => {
    const changes: FileChange[] = [
      {
        filePath: 'claude_notes/001-feature.md',
        after: '# Feature',
        ranges: [],
        snippet: ''
      },
      {
        filePath: 'claude_notes/042-bugfix.md',
        after: '# Bugfix',
        ranges: [],
        snippet: ''
      },
      {
        filePath: 'claude_notes/no-prefix.md',
        after: '# No prefix',
        ranges: [],
        snippet: ''
      }
    ];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        rules: [{
          name: 'markdown-organization',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: [
            'claude_notes/\\d+-.*\\.md'
          ],
          message: 'Markdown files must have numeric prefix'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].file).toBe('claude_notes/no-prefix.md');
  });

  it('should only check files matching patterns', async () => {
    const changes: FileChange[] = [
      {
        filePath: 'docs/guide.md',
        after: '# Guide',
        ranges: [],
        snippet: ''
      },
      {
        filePath: 'src/index.ts',
        after: 'const x = 1;',
        ranges: [],
        snippet: ''
      }
    ];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        rules: [{
          name: 'markdown-organization',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: ['claude_notes/**'],
          message: 'Markdown must be in claude_notes/'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    // Only the .md file should be checked
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].file).toBe('docs/guide.md');
  });

  it('should respect exclude patterns', async () => {
    const changes: FileChange[] = [{
      filePath: 'test-notes.md',
      after: '# Test',
      ranges: [],
      snippet: ''
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        exclude: ['**/test-*.md'],
        rules: [{
          name: 'markdown-organization',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: ['claude_notes/**'],
          message: 'Markdown must be in claude_notes/'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(0);
  });

  it('should support multiple rules', async () => {
    const changes: FileChange[] = [
      {
        filePath: 'notes.md',
        after: '# Notes',
        ranges: [],
        snippet: ''
      },
      {
        filePath: 'src/config.json',
        after: '{}',
        ranges: [],
        snippet: ''
      }
    ];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*'],
        rules: [
          {
            name: 'markdown-organization',
            severity: 'error',
            patterns: ['**/*.md'],
            allowed: ['claude_notes/**'],
            message: 'Markdown must be in claude_notes/'
          },
          {
            name: 'config-in-root',
            severity: 'error',
            patterns: ['**/*.json'],
            allowed: ['*.json', '.claude/**'],
            message: 'Config files must be in root or .claude/'
          }
        ]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].ruleId).toBe('markdown-organization');
    expect(result.messages[1].ruleId).toBe('config-in-root');
  });

  it('should skip rules with no patterns', async () => {
    const changes: FileChange[] = [{
      filePath: 'notes.md',
      after: '# Notes',
      ranges: [],
      snippet: ''
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        rules: [{
          name: 'markdown-organization',
          patterns: [],
          allowed: ['claude_notes/**'],
          message: 'Markdown must be in claude_notes/'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(0);
  });

  it('should handle empty allowed patterns (all files fail)', async () => {
    const changes: FileChange[] = [{
      filePath: 'any-file.md',
      after: '# File',
      ranges: [],
      snippet: ''
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'file-pattern',
        scope: 'whole-file',
        files: ['**/*.md'],
        rules: [{
          name: 'no-markdown',
          severity: 'error',
          patterns: ['**/*.md'],
          allowed: [],
          message: 'No markdown files allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await filePatternValidator(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].message).toBe('No markdown files allowed');
  });
});

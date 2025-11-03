import { describe, it, expect } from 'vitest';
import { regexValidator } from './regex.preset.js';
import type { PresetContext, FileChange } from '../types.js';

describe('regexValidator', () => {
  it('should detect pattern matches in changes-only mode', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.js',
      after: 'const x = 1;\nTODO: fix this\nconst y = 2;',
      ranges: [{ start: 2, end: 2 }],
      snippet: 'TODO: fix this'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        rules: [{
          name: 'no-todos',
          severity: 'error',
          patterns: ['\\bTODO\\b'],
          message: 'TODO comments not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      file: 'test.js',
      line: 2,
      ruleId: 'no-todos',
      severity: 'error',
      message: 'TODO comments not allowed'
    });
    expect(result.errorCount).toBe(1);
    expect(result.warningCount).toBe(0);
  });

  it('should detect multiple patterns for same rule', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.js',
      after: 'TODO: fix\nFIXME: broken\nHACK: workaround',
      ranges: [{ start: 1, end: 3 }],
      snippet: 'TODO: fix\nFIXME: broken\nHACK: workaround'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        rules: [{
          name: 'no-todos',
          severity: 'error',
          patterns: ['\\bTODO\\b', '\\bFIXME\\b', '\\bHACK\\b'],
          message: 'TODO/FIXME/HACK not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(3);
    expect(result.errorCount).toBe(3);
  });

  it('should respect severity levels', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.js',
      after: 'console.log("debug");',
      ranges: [{ start: 1, end: 1 }],
      snippet: 'console.log("debug");'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        rules: [{
          name: 'no-console-log',
          severity: 'warning',
          patterns: ['console\\.log\\('],
          message: 'Remove console.log'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages[0].severity).toBe('warning');
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(1);
  });

  it('should skip rules with severity "off"', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.js',
      after: 'TODO: fix this',
      ranges: [{ start: 1, end: 1 }],
      snippet: 'TODO: fix this'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        rules: [{
          name: 'no-todos',
          severity: 'off',
          patterns: ['\\bTODO\\b'],
          message: 'TODO comments not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(0);
  });

  it('should filter by files glob pattern', async () => {
    const changes: FileChange[] = [
      {
        filePath: 'test.js',
        after: 'TODO: fix',
        ranges: [{ start: 1, end: 1 }],
        snippet: 'TODO: fix'
      },
      {
        filePath: 'test.py',
        after: 'TODO: fix',
        ranges: [{ start: 1, end: 1 }],
        snippet: 'TODO: fix'
      }
    ];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        rules: [{
          name: 'no-todos',
          severity: 'error',
          patterns: ['\\bTODO\\b'],
          message: 'TODO comments not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].file).toBe('test.js');
  });

  it('should respect exclude patterns', async () => {
    const changes: FileChange[] = [{
      filePath: 'new-lint-config.js',
      after: 'TODO: example',
      ranges: [{ start: 1, end: 1 }],
      snippet: 'TODO: example'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        exclude: ['**/*-lint-config.js'],
        rules: [{
          name: 'no-todos',
          severity: 'error',
          patterns: ['\\bTODO\\b'],
          message: 'TODO comments not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(0);
  });

  it('should work in whole-file mode', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.js',
      before: 'line1',
      after: 'line1\nTODO: new line\nline3',
      ranges: [{ start: 2, end: 2 }],
      snippet: 'TODO: new line'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'whole-file',
        files: ['**/*.js'],
        rules: [{
          name: 'no-todos',
          severity: 'error',
          patterns: ['\\bTODO\\b'],
          message: 'TODO comments not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    // Should still only find the one TODO in line 2
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].line).toBe(2);
  });

  it('should detect multiple matches on same line', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.ts',
      after: 'const x: any = foo as any;',
      ranges: [{ start: 1, end: 1 }],
      snippet: 'const x: any = foo as any;'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.ts'],
        rules: [{
          name: 'no-explicit-any',
          severity: 'error',
          patterns: [': any(?=[,\\s\\)\\}\\]\\|;]|$)', 'as any(?=[,\\s\\)\\}\\]\\|;]|$)'],
          message: 'Explicit any not allowed'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].column).not.toBe(result.messages[1].column);
  });

  it('should handle no patterns gracefully', async () => {
    const changes: FileChange[] = [{
      filePath: 'test.js',
      after: 'const x = 1;',
      ranges: [{ start: 1, end: 1 }],
      snippet: 'const x = 1;'
    }];

    const context: PresetContext = {
      changes,
      config: {
        preset: 'regex',
        scope: 'changes-only',
        files: ['**/*.js'],
        rules: [{
          name: 'empty-rule',
          severity: 'error',
          patterns: [],
          message: 'Test'
        }]
      },
      sessionId: 'test',
      cwd: process.cwd()
    };

    const result = await regexValidator(context);

    expect(result.messages).toHaveLength(0);
  });
});

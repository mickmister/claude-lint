#!/usr/bin/env node

/**
 * Plugin installation script
 * Called when the plugin is installed via Claude Code plugin system
 *
 * Note: Claude Code automatically registers hooks from plugin.json.
 * This script handles plugin-specific setup only.
 */

import {existsSync, mkdirSync} from 'fs';
import {resolve} from 'path';

const cwd = process.cwd();
const claudeDir = resolve(cwd, '.claude');
const cacheDir = resolve(cwd, '.claude', '.claude-lint');

console.log('🔧 Installing claude-lint plugin...');
console.log('');

try {
  // Ensure .claude directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, {recursive: true});
  }

  // Create cache directory for session isolation
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, {recursive: true});
  }

  console.log('✅ claude-lint plugin installed successfully!');
  console.log('');
  console.log('🎉 Hooks are automatically registered by Claude Code:');
  console.log('   • PreToolUse: Caches files before edits');
  console.log('   • PostToolUse: Journals changed files');
  console.log('   • Stop: Validates changes and provides feedback');
  console.log('');
  console.log('📚 Default validators are active:');
  console.log('   • No explicit `any` types');
  console.log('   • No TODO/FIXME/HACK comments');
  console.log('   • No manual package.json edits');
  console.log('   • Markdown file organization');
  console.log('');
  console.log('⚙️  Customize rules:');
  console.log('   npx claude-lint init --customize');
  console.log('   (Creates .claude/lint-config.mjs for custom validators)');
  console.log('');
  console.log('📖 Documentation: https://github.com/mickmister/claude-lint#readme');

  process.exit(0);
} catch (error) {
  console.error('❌ Installation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}

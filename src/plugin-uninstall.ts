#!/usr/bin/env node

/**
 * Plugin uninstallation script
 * Called when the plugin is uninstalled via Claude Code plugin system
 *
 * Note: Claude Code automatically removes hooks from plugin.json.
 * This script handles plugin-specific cleanup only.
 */

import {existsSync, rmSync} from 'fs';
import {resolve} from 'path';

const cwd = process.cwd();
const configPath = resolve(cwd, '.claude', 'lint-config.mjs');
const cachePath = resolve(cwd, '.claude', '.claude-lint');

console.log('🔧 Uninstalling claude-lint plugin...');
console.log('');

try {
  let removedCache = false;

  // Remove cache directory
  if (existsSync(cachePath)) {
    rmSync(cachePath, {recursive: true, force: true});
    removedCache = true;
    console.log('✓ Cleared cache directory (.claude/.claude-lint/)');
  }

  // Keep config file for potential reinstallation
  if (existsSync(configPath)) {
    console.log('ℹ️  Preserving custom configuration (.claude/lint-config.mjs)');
    console.log('   Remove manually if no longer needed');
  }

  console.log('');
  console.log('✅ claude-lint plugin uninstalled successfully!');
  console.log('');
  console.log('🔌 Hooks automatically removed by Claude Code');
  console.log('');
  console.log('💡 To reinstall: /plugin install mickmister/claude-lint');

  process.exit(0);
} catch (error) {
  console.error('❌ Uninstallation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}

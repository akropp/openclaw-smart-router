/**
 * Persist plugin config to openclaw.json via atomic read-modify-write.
 *
 * Only touches `plugins.entries.smart-router.config` — leaves everything else untouched.
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { PluginConfig } from './types.js';

const OPENCLAW_CONFIG = join(homedir(), '.openclaw', 'openclaw.json');

export function persistConfig(config: PluginConfig): boolean {
  try {
    if (!existsSync(OPENCLAW_CONFIG)) {
      console.warn('[smart-router] openclaw.json not found at', OPENCLAW_CONFIG);
      return false;
    }

    // Read current config
    const raw = readFileSync(OPENCLAW_CONFIG, 'utf-8');
    const openclawConfig = JSON.parse(raw);

    // Ensure path exists
    if (!openclawConfig.plugins) openclawConfig.plugins = {};
    if (!openclawConfig.plugins.entries) openclawConfig.plugins.entries = {};
    if (!openclawConfig.plugins.entries['smart-router']) {
      openclawConfig.plugins.entries['smart-router'] = { enabled: true };
    }

    // Write only the config section
    openclawConfig.plugins.entries['smart-router'].config = config;

    // Atomic write: write to tmp, then rename
    const tmp = `${OPENCLAW_CONFIG}.smart-router-tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(openclawConfig, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, OPENCLAW_CONFIG);

    return true;
  } catch (err) {
    console.error('[smart-router] Failed to persist config:', err);
    return false;
  }
}

/**
 * /bump command — force the next message in a session to use the complex tier.
 *
 * When a user says /bump, the session is flagged so the next agent run
 * skips scoring entirely and routes to the complex tier model.
 * The bump is consumed after one use.
 *
 * Also tracks bump frequency per scoring pattern for future auto-adjustment.
 */

import type { Tier } from './types.js';
import { insertBumpRecord, isDbEnabled } from './stats.js';

interface BumpState {
  forceTier: Tier;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes — bump expires if not used

// Session key → pending bump
const pendingBumps = new Map<string, BumpState>();

/**
 * Register a bump for a session. Next agent run will use the specified tier.
 */
export function registerBump(sessionKey: string, tier: Tier = 'complex'): void {
  pendingBumps.set(sessionKey, { forceTier: tier, createdAt: Date.now() });
}

/**
 * Consume a pending bump for a session (if any).
 * Returns the forced tier, or null if no bump is pending.
 */
export function consumeBump(sessionKey: string): Tier | null {
  const bump = pendingBumps.get(sessionKey);
  if (!bump) return null;

  // Check TTL
  if (Date.now() - bump.createdAt > TTL_MS) {
    pendingBumps.delete(sessionKey);
    return null;
  }

  pendingBumps.delete(sessionKey);
  return bump.forceTier;
}

/**
 * Record that a bump happened (for learning/feedback).
 * Stores: what the router would have chosen vs what the user wanted.
 */
export function recordBump(
  sessionKey: string,
  agentId: string | undefined,
  originalTier: Tier,
  bumpedToTier: Tier,
  promptPreview: string,
  complexityScore: number,
): void {
  if (!isDbEnabled()) return;
  try {
    insertBumpRecord({
      sessionKey,
      agentId,
      originalTier,
      bumpedToTier,
      promptPreview,
      complexityScore,
    });
  } catch {
    // Non-critical
  }
}

/**
 * Check if a prompt is the /bump command itself.
 */
export function isBumpCommand(prompt: string): { isBump: boolean; tier: Tier } {
  const trimmed = prompt.trim().toLowerCase();

  // /bump or /bump complex or /bump code etc
  if (trimmed === '/bump') {
    return { isBump: true, tier: 'complex' };
  }

  const match = trimmed.match(/^\/bump\s+(trivial|standard|complex|code)$/);
  if (match) {
    return { isBump: true, tier: match[1] as Tier };
  }

  return { isBump: false, tier: 'standard' };
}

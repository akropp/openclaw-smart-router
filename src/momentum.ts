/**
 * Session momentum — prevents tier ping-ponging within a conversation.
 *
 * Rules:
 * 1. Tier can only drop one level per message (complex→standard ok, complex→trivial blocked)
 * 2. Short continuation messages ("Sure", "go ahead") inherit the session's current tier
 * 3. Momentum decays after 5 minutes of inactivity (new topic assumed)
 */

import type { Tier, ScoringResult } from './types.js';

interface SessionState {
  tier: Tier;
  lastTimestamp: number;
  recentTiers: Tier[];  // last N tiers for trend detection
}

const MOMENTUM_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RECENT = 5;
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

// Continuation detection
const CONTINUATION_WORDS = new Set([
  'sure', 'yes', 'yep', 'yeah', 'yea', 'ok', 'okay', 'k',
  'go', 'ahead', 'proceed', 'do', 'it', 'sounds', 'good',
  'great', 'perfect', 'lets', "let's", 'please', 'go for it',
  'absolutely', 'definitely', 'right', 'correct', 'agreed',
  'fine', 'works', 'cool', 'nice', 'awesome', 'lgtm',
  'ship', 'approved', 'confirmed', 'ack', 'roger',
  'np', 'no', 'nah', 'nope', 'not', 'yet', 'wait',
]);

const TIER_ORDER: Record<Tier, number> = {
  trivial: 0,
  standard: 1,
  code: 2,
  complex: 3,
};

const TIER_FROM_ORDER: Tier[] = ['trivial', 'standard', 'code', 'complex'];

const sessions = new Map<string, SessionState>();

let cleanupStarted = false;
function ensureCleanup(): void {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, state] of sessions) {
      if (now - state.lastTimestamp > MOMENTUM_TTL_MS * 2) {
        sessions.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

/**
 * Detect if a message is a short continuation/affirmation.
 */
function isContinuation(prompt: string): boolean {
  const trimmed = prompt.trim();

  // Length check — real questions/tasks are longer
  if (trimmed.length > 50) return false;

  // Has question mark → probably a new question, not a continuation
  if (trimmed.includes('?')) return false;

  // Has code block → not a continuation
  if (trimmed.includes('```')) return false;

  // Check if all words are continuation words
  const words = trimmed.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  if (words.length > 8) return false;  // Too many words for a simple ack

  // At least half the words should be continuation words
  const matchCount = words.filter(w => CONTINUATION_WORDS.has(w)).length;
  return matchCount >= Math.ceil(words.length * 0.5);
}

/**
 * Apply momentum to a scoring result within a session context.
 *
 * Returns the adjusted tier (may be higher than the raw score suggests).
 */
export function applyMomentum(
  sessionKey: string | undefined,
  prompt: string,
  rawResult: ScoringResult,
): Tier {
  ensureCleanup();

  // No session tracking possible → return raw tier
  if (!sessionKey) return rawResult.tier;

  const now = Date.now();
  const state = sessions.get(sessionKey);

  // No prior state or session expired → start fresh
  if (!state || (now - state.lastTimestamp > MOMENTUM_TTL_MS)) {
    sessions.set(sessionKey, {
      tier: rawResult.tier,
      lastTimestamp: now,
      recentTiers: [rawResult.tier],
    });
    return rawResult.tier;
  }

  const prevTier = state.tier;
  let adjustedTier = rawResult.tier;

  // Rule 1: Continuation messages inherit the session tier
  if (isContinuation(prompt)) {
    adjustedTier = prevTier;
  }
  // Rule 2: Tier can only drop one level per message
  else {
    const prevOrder = TIER_ORDER[prevTier];
    const newOrder = TIER_ORDER[adjustedTier];

    // If the new tier is more than one level below the previous, cap the drop
    if (prevOrder - newOrder > 1) {
      adjustedTier = TIER_FROM_ORDER[Math.max(0, prevOrder - 1)] ?? rawResult.tier;
    }
  }

  // Update state
  state.tier = adjustedTier;
  state.lastTimestamp = now;
  state.recentTiers = [adjustedTier, ...state.recentTiers].slice(0, MAX_RECENT);
  sessions.set(sessionKey, state);

  return adjustedTier;
}

/**
 * Get current momentum state for a session (for stats/debugging).
 */
export function getSessionMomentum(sessionKey: string): SessionState | undefined {
  return sessions.get(sessionKey);
}

/**
 * Clear all momentum state (for testing).
 */
export function clearMomentum(): void {
  sessions.clear();
}

// Export for testing
export { isContinuation as _isContinuation };

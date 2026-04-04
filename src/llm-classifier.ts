/**
 * LLM-based complexity classifier using a local Ollama model.
 *
 * Only invoked when the heuristic scorer produces an ambiguous score
 * (between the confident-trivial and confident-complex thresholds).
 * Falls back to the heuristic tier on timeout or error.
 */

import type { Tier } from './types.js';
import type { LlmClassifierConfig } from './config.js';

const CLASSIFICATION_PROMPT = `You are a prompt complexity classifier. Given a user message (and optionally the last assistant message for context), classify the complexity as exactly one of: trivial, standard, complex, code.

Rules:
- trivial: Simple acknowledgments, yes/no, short greetings, "thanks", "ok", single-word replies that are clearly just confirming something
- standard: Normal questions, moderate requests, straightforward tasks, general conversation
- complex: Deep analysis, architecture decisions, multi-step reasoning, tradeoff evaluation, system design, anything requiring significant expertise
- code: Requests involving code generation, debugging, refactoring, or technical implementation

IMPORTANT: Consider context. If the prior assistant message was a complex plan and the user says "Sure" or "Go ahead", that is a CONTINUATION of a complex conversation — classify as "complex", not "trivial".

Respond with ONLY the tier name (trivial, standard, complex, or code). No explanation.`;

interface ClassifyInput {
  prompt: string;
  lastAssistantMessage?: string;
}

const VALID_TIERS = new Set<Tier>(['trivial', 'standard', 'complex', 'code']);

/**
 * Call Ollama to classify prompt complexity.
 * Returns the tier, or null on timeout/error (caller falls back to heuristic).
 */
export async function classifyWithLlm(
  input: ClassifyInput,
  config: LlmClassifierConfig,
): Promise<Tier | null> {
  const { ollamaUrl, model, timeoutMs } = config;

  // Build the user message with context
  let userMessage = '';
  if (input.lastAssistantMessage) {
    // Truncate assistant message to keep the classification call cheap
    const truncated = input.lastAssistantMessage.length > 500
      ? input.lastAssistantMessage.slice(0, 500) + '...'
      : input.lastAssistantMessage;
    userMessage += `[Last assistant message]:\n${truncated}\n\n`;
  }
  userMessage += `[Current user message]:\n${input.prompt}`;

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: CLASSIFICATION_PROMPT },
      { role: 'user', content: userMessage },
    ],
    stream: false,
    options: {
      temperature: 0,
      num_predict: 10,  // We only need one word
    },
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[smart-router] Ollama returned ${res.status}`);
      return null;
    }

    const data = await res.json() as { message?: { content?: string } };
    const content = data.message?.content?.trim().toLowerCase() ?? '';

    // Extract the tier from the response (might have extra text)
    for (const tier of VALID_TIERS) {
      if (content.includes(tier)) {
        return tier;
      }
    }

    console.warn(`[smart-router] LLM returned unrecognized tier: "${content}"`);
    return null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn(`[smart-router] LLM classifier timed out after ${timeoutMs}ms`);
    } else {
      console.warn(`[smart-router] LLM classifier error:`, (err as Error).message);
    }
    return null;
  }
}

// Simple in-memory cache to avoid re-classifying the same prompt
interface CacheEntry {
  tier: Tier;
  expiry: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function classifyWithCache(
  input: ClassifyInput,
  config: LlmClassifierConfig,
): Promise<Tier | null> {
  // Simple hash — we don't need cryptographic strength
  const key = input.prompt.slice(0, 200) + '|' + (input.lastAssistantMessage?.slice(0, 100) ?? '');
  const now = Date.now();

  const cached = cache.get(key);
  if (cached && cached.expiry > now) {
    return cached.tier;
  }

  const tier = await classifyWithLlm(input, config);

  if (tier) {
    cache.set(key, { tier, expiry: now + CACHE_TTL_MS });
    // Evict old entries periodically
    if (cache.size > 500) {
      for (const [k, v] of cache) {
        if (v.expiry < now) cache.delete(k);
      }
    }
  }

  return tier;
}

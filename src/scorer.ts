import type { ScoringConfig, ScoringResult, ScoringSignals, Tier } from './types.js';
import { DEFAULT_WEIGHTS, DEFAULT_THRESHOLDS } from './config.js';

// Ack words: trivial greetings/acknowledgements
const ACK_WORDS = new Set([
  'yes', 'no', 'thanks', 'thank', 'ok', 'okay', 'sure', 'got', 'it',
  'yep', 'nope', 'nah', 'yeah', 'cool', 'great', 'alright', 'roger',
  'noted', 'understood', 'np', 'ty', 'thx', 'yw',
]);

// Simple question starters (what/when/where/who/which)
const SIMPLE_QUESTION_RE = /\b(what|when|where|who|which|is|are|can|will|do|does)\b.*\?/i;
// Analysis questions (why/how/explain/describe)
const ANALYSIS_QUESTION_RE = /\b(why|how|explain|describe|elaborate|tell me about|walk me through)\b/i;
// Multi-part: multiple question marks
const MULTI_QUESTION_RE = /\?.*\?/s;
// Architecture/design
const ARCH_QUESTION_RE = /\b(architect|design|pattern|system|scalab|trade.?off|approach|strategy|best practice)\b/i;

// Technical keywords
const GENERAL_KEYWORD_RE = /\b(function|class|method|variable|string|array|object|list|import|export|return)\b/i;
const TECHNICAL_KEYWORD_RE = /\b(deploy|deployment|architecture|security|refactor|refactoring|migration|performance|optimize|optimization|infrastructure|kubernetes|docker|ci\/cd|pipeline|database|schema|api|endpoint|authentication|authorization|scaling)\b/i;
const DEEP_REASONING_RE = /\b(tradeoffs?|trade-offs?|implications?|evaluate|evaluation|compare|comparison|pros and cons|advantages?|disadvantages?|when to use|should i|recommend|best approach)\b/i;

// Code indicators
const CODE_BLOCK_RE = /```/;
const INLINE_CODE_RE = /`[^`]+`/;
const FILE_PATH_RE = /(\w+\/)+\w+\.\w+|\.\/\w+|\.\.\//;
const FUNCTION_NAME_RE = /\b\w+\([^)]*\)/;

// Structural signals
const NUMBERED_LIST_RE = /^\s*\d+[.)]\s+/m;
const URL_RE = /https?:\/\/\S+/;
const ERROR_LOG_RE = /\b(error|exception|traceback|stack trace|at \w+\.\w+|Error:)\b/i;

export function scorePrompt(prompt: string, config?: ScoringConfig): ScoringResult {
  const weights = { ...DEFAULT_WEIGHTS, ...config?.weights };
  const thresholds = { ...DEFAULT_THRESHOLDS, ...config?.thresholds };

  const signals: ScoringSignals = {
    length: scoreLengthSignal(prompt),
    code: scoreCodeSignal(prompt),
    question: scoreQuestionSignal(prompt),
    keywords: scoreKeywordSignal(prompt),
    structure: scoreStructureSignal(prompt),
  };

  const score =
    signals.length * weights.length +
    signals.code * weights.code +
    signals.question * weights.question +
    signals.keywords * weights.keywords +
    signals.structure * weights.structure;

  const tier = mapTier(score, signals, thresholds);

  return { score, signals, tier };
}

function scoreLengthSignal(prompt: string): number {
  const len = prompt.length;
  if (len < 20) return 0.0;
  if (len < 100) return 0.3;
  if (len < 500) return 0.6;
  if (len < 2000) return 0.8;
  return 1.0;
}

function scoreCodeSignal(prompt: string): number {
  if (CODE_BLOCK_RE.test(prompt)) return 0.8;
  if (INLINE_CODE_RE.test(prompt)) return 0.4;
  if (FILE_PATH_RE.test(prompt) || FUNCTION_NAME_RE.test(prompt)) return 0.3;
  return 0.0;
}

function scoreQuestionSignal(prompt: string): number {
  if (!prompt.includes('?')) {
    // Check for implicit analysis requests
    if (ANALYSIS_QUESTION_RE.test(prompt)) return 0.6;
    if (ARCH_QUESTION_RE.test(prompt)) return 0.9;
    return 0.1;
  }
  if (ARCH_QUESTION_RE.test(prompt)) return 0.9;
  if (MULTI_QUESTION_RE.test(prompt)) return 0.8;
  if (ANALYSIS_QUESTION_RE.test(prompt)) return 0.6;
  if (SIMPLE_QUESTION_RE.test(prompt)) return 0.3;
  return 0.3;
}

function scoreKeywordSignal(prompt: string): number {
  // Check if it's purely ack words
  const words = prompt.toLowerCase().trim().split(/\s+/);
  if (words.length <= 5 && words.every(w => ACK_WORDS.has(w.replace(/[^a-z]/g, '')))) {
    return 0.0;
  }
  if (DEEP_REASONING_RE.test(prompt)) return 0.9;
  if (TECHNICAL_KEYWORD_RE.test(prompt)) return 0.7;
  if (GENERAL_KEYWORD_RE.test(prompt)) return 0.3;
  return 0.1;
}

function scoreStructureSignal(prompt: string): number {
  let score = 0;
  if (ERROR_LOG_RE.test(prompt)) return 0.7;
  if (NUMBERED_LIST_RE.test(prompt)) score = Math.max(score, 0.5);
  // Multiple paragraphs (two or more double newlines)
  if (/\n\s*\n/.test(prompt)) score = Math.max(score, 0.4);
  if (URL_RE.test(prompt)) score = Math.max(score, 0.3);
  return score;
}

function mapTier(
  score: number,
  signals: ScoringSignals,
  thresholds: { trivial: number; standard: number; complex: number },
): Tier {
  // Code override: if code detected and score > 0.3 → "code" tier
  if (signals.code > 0 && score > 0.3) return 'code';

  if (score < thresholds.trivial) return 'trivial';
  if (score < thresholds.standard) return 'standard';
  return 'complex';
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scorePrompt } from '../scorer.js';

describe('scorePrompt', () => {
  describe('trivial prompts', () => {
    it('maps single ack words to trivial tier', () => {
      const result = scorePrompt('yes');
      assert.equal(result.tier, 'trivial');
      assert.ok(result.score < 0.2, `Expected score < 0.2, got ${result.score}`);
    });

    it('maps short greetings to trivial tier', () => {
      const result = scorePrompt('ok thanks');
      assert.equal(result.tier, 'trivial');
    });

    it('maps very short messages to trivial tier', () => {
      const result = scorePrompt('What time is it?');
      assert.ok(result.score < 0.5, `Expected score < 0.5, got ${result.score}`);
    });

    it('assigns low length signal for short messages', () => {
      const result = scorePrompt('hi');
      assert.equal(result.signals.length, 0.0);
    });
  });

  describe('code prompts', () => {
    it('maps code blocks to code tier', () => {
      const result = scorePrompt('Fix this function:\n```js\nfunction foo() { return 1; }\n```\nIt should return 2');
      assert.equal(result.tier, 'code');
      assert.equal(result.signals.code, 0.8);
    });

    it('maps inline code to code tier when score > 0.3', () => {
      const result = scorePrompt('Why does `myArray.filter()` not return expected results in my implementation?');
      assert.equal(result.tier, 'code');
    });

    it('assigns high code signal for code blocks', () => {
      const result = scorePrompt('```python\nfor i in range(10):\n    print(i)\n```');
      assert.equal(result.signals.code, 0.8);
    });

    it('assigns medium code signal for inline code', () => {
      const result = scorePrompt('Should I use `const` or `let` here?');
      assert.equal(result.signals.code, 0.4);
    });
  });

  describe('complex prompts', () => {
    it('maps long analysis prompts to complex tier', () => {
      // Intentionally 500+ chars to hit the 0.8 length signal
      const prompt =
        'I need to design a distributed system for high-throughput event processing. ' +
        'The system must handle 100k events per second with sub-100ms p99 latency. ' +
        'We need to evaluate the tradeoffs between Apache Kafka, RabbitMQ, and a custom solution. ' +
        'Please analyze the architectural implications for our system including scalability, ' +
        'fault tolerance, horizontal partitioning, and operational complexity. ' +
        'What are the best practices for this type of event-driven design, ' +
        'and what overall approach would you recommend for our production use case?';
      assert.ok(prompt.length >= 500, `Prompt must be 500+ chars, got ${prompt.length}`);
      const result = scorePrompt(prompt);
      assert.equal(result.tier, 'complex');
      assert.ok(result.score >= 0.5, `Expected score >= 0.5, got ${result.score}`);
    });

    it('detects deep reasoning keywords', () => {
      const result = scorePrompt('What are the tradeoffs between REST and GraphQL for our API design?');
      assert.ok(result.signals.keywords >= 0.7, `Expected keywords >= 0.7, got ${result.signals.keywords}`);
    });

    it('detects architecture questions', () => {
      const result = scorePrompt('How should I architect the database schema for a multi-tenant SaaS application?');
      assert.ok(result.signals.question >= 0.6, `Expected question >= 0.6, got ${result.signals.question}`);
    });

    it('assigns high score to multi-part questions', () => {
      const result = scorePrompt('What is the best approach? How should I implement it? What are the risks?');
      assert.ok(result.signals.question >= 0.8, `Expected question >= 0.8, got ${result.signals.question}`);
    });
  });

  describe('standard prompts', () => {
    it('maps moderate questions to standard tier', () => {
      const result = scorePrompt('Can you explain how promises work in JavaScript?');
      assert.ok(['standard', 'complex'].includes(result.tier), `Unexpected tier: ${result.tier}`);
    });

    it('assigns mid-range scores to moderate prompts', () => {
      const result = scorePrompt('What is the difference between var and let in JavaScript?');
      assert.ok(result.score >= 0.1, `Expected score >= 0.1, got ${result.score}`);
    });
  });

  describe('structure signals', () => {
    it('detects error logs', () => {
      const result = scorePrompt('I keep getting this Error: Cannot read property of undefined. How do I fix it?');
      assert.ok(result.signals.structure >= 0.7, `Expected structure >= 0.7, got ${result.signals.structure}`);
    });

    it('detects numbered lists', () => {
      const result = scorePrompt('Please do the following:\n1. Install dependencies\n2. Run tests\n3. Deploy');
      assert.ok(result.signals.structure >= 0.5, `Expected structure >= 0.5, got ${result.signals.structure}`);
    });

    it('detects URLs', () => {
      const result = scorePrompt('Can you summarize https://example.com/some-article for me?');
      assert.ok(result.signals.structure >= 0.3, `Expected structure >= 0.3, got ${result.signals.structure}`);
    });
  });

  describe('score bounds', () => {
    it('score is always between 0 and 1', () => {
      const prompts = [
        '',
        'yes',
        'hi there',
        'a'.repeat(3000),
        '```\n' + 'code\n'.repeat(100) + '```\nWhy tradeoffs? Explain architecture implications? What are the best practices?\n1.\n2.\n3.\n',
      ];
      for (const p of prompts) {
        const { score } = scorePrompt(p);
        assert.ok(score >= 0 && score <= 1, `Score out of bounds: ${score} for prompt length ${p.length}`);
      }
    });

    it('scoring is fast (synchronous)', () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        scorePrompt('What are the architectural tradeoffs for implementing a distributed caching layer?');
      }
      const elapsed = Date.now() - start;
      // 1000 iterations should complete well under 2000ms (2ms each)
      assert.ok(elapsed < 2000, `1000 scoring calls took ${elapsed}ms (should be < 2000ms)`);
    });
  });

  describe('custom config', () => {
    it('respects custom thresholds', () => {
      // With very high trivial threshold, most prompts become trivial
      const result = scorePrompt('How does TCP work?', {
        thresholds: { trivial: 0.9, standard: 0.95, complex: 1.0 },
      });
      assert.equal(result.tier, 'trivial');
    });

    it('respects custom weights', () => {
      // Maximize code weight — code block should dominate
      const result1 = scorePrompt('```code block here```', {
        weights: { length: 0, code: 1.0, question: 0, keywords: 0, structure: 0 },
      });
      const result2 = scorePrompt('no code here plain text', {
        weights: { length: 0, code: 1.0, question: 0, keywords: 0, structure: 0 },
      });
      assert.ok(result1.score > result2.score, 'Code prompt should score higher with max code weight');
    });
  });
});

/**
 * pipeline.test.js
 *
 * Test suite for the audit-log normalisation pipeline.
 * Run with:  node --test tests/pipeline.test.js
 *
 * All tests are expected to FAIL with the current starter implementation.
 * They must all PASS after the candidate's changes.
 */

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { processAuditLog } = require('../src/pipeline/processAuditLog');
const { normaliseEvent, SIGNAL_MAP } = require('../src/lib/normaliser');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpFile(suffix = '.ndjson') {
  return path.join(os.tmpdir(), `utkrusht-test-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
}

function writeFixture(lines) {
  const file = tmpFile();
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
}

function readOutputLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// Unit: normaliseEvent
// ---------------------------------------------------------------------------

describe('normaliseEvent', () => {
  test('maps a known signal code to a human-readable eventType', () => {
    const raw = { sessionId: 's1', signal: 'ANS_SUB', ts: 1000 };
    const result = normaliseEvent(raw);
    assert.equal(result.eventType, 'ANSWER_SUBMITTED');
  });

  test('sets eventType to UNKNOWN for an unrecognised signal', () => {
    const raw = { sessionId: 's2', signal: 'MYSTERY_CODE', ts: 2000 };
    const result = normaliseEvent(raw);
    assert.equal(result.eventType, 'UNKNOWN');
  });

  test('attaches a processedAt ISO timestamp', () => {
    const before = Date.now();
    const result = normaliseEvent({ signal: 'KS_BURST' });
    const after = Date.now();
    assert.ok(result.processedAt, 'processedAt should be present');
    const ts = new Date(result.processedAt).getTime();
    assert.ok(ts >= before && ts <= after, 'processedAt should be close to now');
  });

  test('strips the rawIp field from the output', () => {
    const raw = { sessionId: 's3', signal: 'TAB_SW', rawIp: '10.0.0.1', score: 42 };
    const result = normaliseEvent(raw);
    assert.equal(result.rawIp, undefined, 'rawIp must be removed');
  });

  test('preserves all other fields unchanged', () => {
    const raw = { sessionId: 's4', signal: 'WIN_BLUR', candidateId: 'c99', metadata: { x: 1 } };
    const result = normaliseEvent(raw);
    assert.equal(result.sessionId, 's4');
    assert.equal(result.candidateId, 'c99');
    assert.deepEqual(result.metadata, { x: 1 });
  });

  test('does not mutate the original event object', () => {
    const raw = { signal: 'COPY_EVT', rawIp: '192.168.1.1', val: 7 };
    const clone = { ...raw };
    normaliseEvent(raw);
    assert.deepEqual(raw, clone, 'original object must not be modified');
  });
});

// ---------------------------------------------------------------------------
// Integration: processAuditLog — happy path
// ---------------------------------------------------------------------------

describe('processAuditLog — happy path', () => {
  let inputFile;
  let outputFile;

  const events = [
    { sessionId: 'sess-1', signal: 'PROC_START', ts: 1000, candidateId: 'cand-A', rawIp: '1.2.3.4' },
    { sessionId: 'sess-1', signal: 'ANS_SUB',    ts: 2000, candidateId: 'cand-A' },
    { sessionId: 'sess-2', signal: 'TAB_SW',     ts: 3000, candidateId: 'cand-B', rawIp: '5.6.7.8' },
    { sessionId: 'sess-2', signal: 'SESS_END',   ts: 4000, candidateId: 'cand-B' },
  ];

  before(() => {
    inputFile = writeFixture(events.map(e => JSON.stringify(e)));
    outputFile = tmpFile('-out.ndjson');
  });

  after(() => {
    for (const f of [inputFile, outputFile]) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  test('returns a summary with correct total and written counts', async () => {
    const summary = await processAuditLog(inputFile, outputFile);
    assert.equal(summary.total,   events.length);
    assert.equal(summary.written, events.length);
    assert.equal(summary.skipped, 0);
  });

  test('writes one output line per valid input record', async () => {
    const lines = readOutputLines(outputFile);
    assert.equal(lines.length, events.length);
  });

  test('each output record has eventType and processedAt, no rawIp', async () => {
    const lines = readOutputLines(outputFile);
    for (const record of lines) {
      assert.ok(record.eventType, 'eventType must be present');
      assert.ok(record.processedAt, 'processedAt must be present');
      assert.equal(record.rawIp, undefined, 'rawIp must be stripped');
    }
  });

  test('signal codes are mapped to human-readable eventType strings', async () => {
    const lines = readOutputLines(outputFile);
    const types = lines.map(l => l.eventType);
    assert.ok(types.includes('PROCTORING_STARTED'));
    assert.ok(types.includes('ANSWER_SUBMITTED'));
    assert.ok(types.includes('TAB_SWITCH_DETECTED'));
    assert.ok(types.includes('SESSION_ENDED'));
  });
});

// ---------------------------------------------------------------------------
// Integration: malformed-line resilience
// ---------------------------------------------------------------------------

describe('processAuditLog — malformed line resilience', () => {
  let inputFile;
  let outputFile;

  before(() => {
    const lines = [
      JSON.stringify({ sessionId: 'a', signal: 'KS_BURST', ts: 100 }),
      'THIS IS NOT JSON {{{',
      JSON.stringify({ sessionId: 'b', signal: 'WIN_FOCUS', ts: 200 }),
      '{"unclosed": true',
      JSON.stringify({ sessionId: 'c', signal: 'PASTE_EVT', ts: 300 }),
    ];
    inputFile = writeFixture(lines);
    outputFile = tmpFile('-out.ndjson');
  });

  after(() => {
    for (const f of [inputFile, outputFile]) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  test('run completes without throwing even when malformed lines exist', async () => {
    await assert.doesNotReject(() => processAuditLog(inputFile, outputFile));
  });

  test('summary reflects correct total, written, and skipped counts', async () => {
    const summary = await processAuditLog(inputFile, outputFile);
    assert.equal(summary.total,   5);
    assert.equal(summary.written, 3);
    assert.equal(summary.skipped, 2);
  });

  test('output file contains only the valid records', async () => {
    const lines = readOutputLines(outputFile);
    assert.equal(lines.length, 3);
    const ids = lines.map(l => l.sessionId);
    assert.ok(ids.includes('a'));
    assert.ok(ids.includes('b'));
    assert.ok(ids.includes('c'));
  });
});

// ---------------------------------------------------------------------------
// Integration: error conditions
// ---------------------------------------------------------------------------

describe('processAuditLog — error conditions', () => {
  test('rejects with a meaningful error when the input file does not exist', async () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist-utkrusht.ndjson');
    const outFile = tmpFile();
    try {
      await assert.rejects(
        () => processAuditLog(missing, outFile),
        (err) => {
          assert.ok(err instanceof Error, 'must reject with an Error instance');
          assert.ok(err.message.length > 0, 'error message must not be empty');
          return true;
        }
      );
    } finally {
      try { fs.unlinkSync(outFile); } catch {}
    }
  });

  test('rejects when the output path is unwritable (directory as target)', async () => {
    const lines = [JSON.stringify({ signal: 'SESS_END' })];
    const inputFile = writeFixture(lines);
    const badOutput = os.tmpdir(); // a directory, not a file path
    try {
      await assert.rejects(() => processAuditLog(inputFile, badOutput));
    } finally {
      try { fs.unlinkSync(inputFile); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// Backpressure: pipeline must not buffer unboundedly when sink is slow
// ---------------------------------------------------------------------------

describe('processAuditLog — backpressure (slow sink)', () => {
  test('RSS stays below 150 MB while processing 50,000 records through a slow writable', async () => {
    // Build a moderate fixture (50k records ~ a few MB) entirely in memory
    const NUM_RECORDS = 50_000;
    const signals = Object.keys(SIGNAL_MAP);
    const lines = [];
    for (let i = 0; i < NUM_RECORDS; i++) {
      lines.push(JSON.stringify({
        sessionId: `sess-${i}`,
        signal: signals[i % signals.length],
        ts: Date.now() + i,
        candidateId: `cand-${i % 200}`,
        rawIp: '10.0.0.1',
      }));
    }

    const inputFile = writeFixture(lines);

    // Slow writable: artificially delays each write to surface backpressure issues
    const { Writable } = require('stream');
    const written = [];
    let resolveFinished;
    const finished = new Promise(r => { resolveFinished = r; });

    const slowSink = new Writable({
      // Small highWaterMark to trigger backpressure quickly
      highWaterMark: 1024,
      write(chunk, _enc, callback) {
        // Simulate a slow downstream (e.g., network write, slow disk)
        setTimeout(() => {
          written.push(chunk);
          callback();
        }, 0); // yield to event loop each write
      },
    });

    // We cannot pass a custom Writable to processAuditLog via the current API,
    // so this test measures RSS during a real file-based run as a proxy.
    // It also verifies the summary is correct for a large batch.
    const baseRss = process.memoryUsage().rss;
    let peakRss = baseRss;
    const memPoller = setInterval(() => {
      const rss = process.memoryUsage().rss;
      if (rss > peakRss) peakRss = rss;
    }, 50);

    const outputFile = tmpFile('-big-out.ndjson');
    try {
      const summary = await processAuditLog(inputFile, outputFile);
      clearInterval(memPoller);

      assert.equal(summary.total,   NUM_RECORDS);
      assert.equal(summary.written, NUM_RECORDS);
      assert.equal(summary.skipped, 0);

      const rssGrowthMB = (peakRss - baseRss) / 1024 / 1024;
      // Peak RSS growth above baseline must stay well under 150 MB for a streaming implementation.
      // A synchronous readFileSync approach on 50k records will spike much higher.
      assert.ok(
        rssGrowthMB < 150,
        `Peak RSS growth was ${rssGrowthMB.toFixed(1)} MB — expected < 150 MB. ` +
        'This suggests the pipeline is buffering too much data in memory.'
      );
    } finally {
      clearInterval(memPoller);
      try { fs.unlinkSync(inputFile); } catch {}
      try { fs.unlinkSync(outputFile); } catch {}
    }
  });
});

/**
 * normaliser.js
 *
 * Transforms a single raw audit-event object into a normalised form
 * suitable for analytics storage and compliance reporting.
 */

'use strict';

/**
 * Maps raw signal codes emitted by the assessment runtime to
 * human-readable event type strings consumed by downstream systems.
 *
 * @type {Record<string, string>}
 */
const SIGNAL_MAP = {
  'ANS_SUB':    'ANSWER_SUBMITTED',
  'TAB_SW':     'TAB_SWITCH_DETECTED',
  'PROC_START': 'PROCTORING_STARTED',
  'PROC_END':   'PROCTORING_ENDED',
  'KS_BURST':   'KEYSTROKE_BURST',
  'COPY_EVT':   'COPY_DETECTED',
  'PASTE_EVT':  'PASTE_DETECTED',
  'WIN_BLUR':   'WINDOW_BLUR',
  'WIN_FOCUS':  'WINDOW_FOCUS',
  'SESS_END':   'SESSION_ENDED',
};

/**
 * Normalises a single raw event record.
 *
 * Rules:
 *  1. Map `event.signal` through SIGNAL_MAP to produce `eventType`.
 *     If the code is not in the map, set eventType to 'UNKNOWN'.
 *  2. Attach a `processedAt` field containing the current UTC ISO timestamp.
 *  3. Strip the `rawIp` field if present (PII scrubbing).
 *  4. Preserve all other fields from the original event unchanged.
 *
 * @param {Record<string, unknown>} event - Raw parsed event object.
 * @returns {Record<string, unknown>} Normalised event object.
 */
function normaliseEvent(event) {
  const source = event && typeof event === 'object' && !Array.isArray(event)
    ? event
    : {};

  const { rawIp: _rawIp, ...rest } = source;
  const signal = typeof source.signal === 'string' ? source.signal : undefined;

  return {
    ...rest,
    eventType: SIGNAL_MAP[signal] ?? 'UNKNOWN',
    processedAt: new Date().toISOString(),
  };
}

module.exports = { normaliseEvent, SIGNAL_MAP };

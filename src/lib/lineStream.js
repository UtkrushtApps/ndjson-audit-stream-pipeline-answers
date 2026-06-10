/**
 * lineStream.js
 *
 * Utility module — feel free to use, modify, or ignore this file.
 *
 * Placeholder location for any stream-related helpers you want to
 * build as part of the refactor. The file is intentionally empty
 * so the module graph resolves without errors.
 *
 * You might find it useful to implement a Transform stream here that
 * converts arbitrary byte chunks into discrete text lines, but the
 * design is entirely up to you.
 */

'use strict';

const { Transform } = require('stream');

class LineSplitter extends Transform {
  constructor() {
    super({ readableObjectMode: true });
    this.buffer = '';
  }

  _transform(chunk, _encoding, callback) {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      let line = this.buffer.slice(0, newlineIndex);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      this.push(line);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf('\n');
    }

    callback();
  }

  _flush(callback) {
    if (this.buffer.length > 0) {
      let line = this.buffer;
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      this.push(line);
    }

    this.buffer = '';
    callback();
  }
}

module.exports = { LineSplitter };

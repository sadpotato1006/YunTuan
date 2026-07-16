const bufferUtils = require("./buffer");

class SseParser {
  constructor(onEvent) {
    this._onEvent = typeof onEvent === "function" ? onEvent : () => {};
    this._buffer = new Uint8Array(0);
  }

  push(value) {
    const incoming = bufferUtils.toUint8Array(value);
    this._buffer = concatBytes(this._buffer, incoming);
    this._drain(false);
  }

  finish() {
    this._drain(true);
  }

  _drain(final) {
    let boundary = findEventBoundary(this._buffer);
    while (boundary) {
      const block = this._buffer.slice(0, boundary.index);
      this._buffer = this._buffer.slice(boundary.index + boundary.length);
      this._emit(block);
      boundary = findEventBoundary(this._buffer);
    }
    if (final && this._buffer.length) {
      this._emit(this._buffer);
      this._buffer = new Uint8Array(0);
    }
  }

  _emit(bytes) {
    if (!bytes.length) return;
    const text = bufferUtils.arrayBufferToUtf8(bytes).replace(/^\uFEFF/, "");
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    let event = "message";
    const data = [];
    lines.forEach(line => {
      if (!line || line.startsWith(":")) return;
      const separator = line.indexOf(":");
      const field = separator >= 0 ? line.slice(0, separator) : line;
      let value = separator >= 0 ? line.slice(separator + 1) : "";
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value || "message";
      if (field === "data") data.push(value);
    });
    if (data.length) this._onEvent({ event, data: data.join("\n") });
  }
}

function concatBytes(left, right) {
  if (!left.length) return new Uint8Array(right);
  if (!right.length) return new Uint8Array(left);
  const result = new Uint8Array(left.length + right.length);
  result.set(left, 0);
  result.set(right, left.length);
  return result;
}

function findEventBoundary(bytes) {
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 10 && bytes[index + 1] === 10) {
      return { index, length: 2 };
    }
    if (index < bytes.length - 3 && bytes[index] === 13 && bytes[index + 1] === 10 &&
        bytes[index + 2] === 13 && bytes[index + 3] === 10) {
      return { index, length: 4 };
    }
  }
  return null;
}

module.exports = {
  SseParser,
  concatBytes,
  findEventBoundary
};

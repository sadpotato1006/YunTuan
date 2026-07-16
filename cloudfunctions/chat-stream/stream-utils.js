const { StringDecoder } = require("string_decoder");

const DEFAULT_SEGMENT_CHARACTERS = 40;
const TERMINAL_PUNCTUATION = /[。！？!?；;\n]/;
const NATURAL_PUNCTUATION = /[，,、：:]/;

class UpstreamSseParser {
  constructor() {
    this._decoder = new StringDecoder("utf8");
    this._buffer = "";
  }

  push(chunk) {
    this._buffer += this._decoder.write(chunk);
    return this._drain(false);
  }

  finish() {
    this._buffer += this._decoder.end();
    return this._drain(true);
  }

  _drain(final) {
    const payloads = [];
    this._buffer = this._buffer.replace(/\r\n/g, "\n");
    let boundary = this._buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = this._buffer.slice(0, boundary);
      this._buffer = this._buffer.slice(boundary + 2);
      const payload = readSseData(block);
      if (payload !== null) payloads.push(payload);
      boundary = this._buffer.indexOf("\n\n");
    }
    if (final && this._buffer.trim()) {
      const payload = readSseData(this._buffer);
      if (payload !== null) payloads.push(payload);
      this._buffer = "";
    }
    return payloads;
  }
}

class SentenceSegmenter {
  constructor(maximumCharacters, segmentCharacters, firstSegmentCharacters) {
    this.maximumCharacters = maximumCharacters;
    this.segmentCharacters = segmentCharacters || DEFAULT_SEGMENT_CHARACTERS;
    this.firstSegmentCharacters = firstSegmentCharacters || this.segmentCharacters;
    this.acceptedCharacters = 0;
    this.emittedSegments = 0;
    this.buffer = [];
  }

  push(value) {
    const incoming = Array.from(typeof value === "string" ? value : "");
    const remaining = Math.max(0, this.maximumCharacters - this.acceptedCharacters);
    const accepted = incoming.slice(0, remaining);
    this.acceptedCharacters += accepted.length;
    this.buffer.push(...accepted);
    return this._drain(false);
  }

  finish() {
    return this._drain(true);
  }

  _drain(final) {
    const segments = [];
    while (this.buffer.length) {
      const targetCharacters = this.emittedSegments === 0
        ? this.firstSegmentCharacters
        : this.segmentCharacters;
      const terminalIndex = this.buffer.findIndex(character => TERMINAL_PUNCTUATION.test(character));
      const firstNaturalIndex = this.emittedSegments === 0 &&
        this.firstSegmentCharacters < this.segmentCharacters
        ? this.buffer.findIndex((character, index) =>
          index >= Math.floor(targetCharacters * 0.5) && NATURAL_PUNCTUATION.test(character)
        )
        : -1;
      let splitAt = 0;

      if (terminalIndex >= 0 && terminalIndex < targetCharacters) {
        splitAt = terminalIndex + 1;
      } else if (firstNaturalIndex >= 0 && firstNaturalIndex < targetCharacters) {
        splitAt = firstNaturalIndex + 1;
      } else if (this.buffer.length >= targetCharacters) {
        splitAt = targetCharacters;
        const minimumNaturalSplit = Math.floor(targetCharacters * 0.55);
        for (let index = targetCharacters - 1; index >= minimumNaturalSplit; index -= 1) {
          if (TERMINAL_PUNCTUATION.test(this.buffer[index]) || NATURAL_PUNCTUATION.test(this.buffer[index])) {
            splitAt = index + 1;
            break;
          }
        }
      } else if (final) {
        splitAt = this.buffer.length;
      }

      if (!splitAt) break;
      const segment = this.buffer.splice(0, splitAt).join("");
      if (segment.trim()) {
        segments.push(segment);
        this.emittedSegments += 1;
      }
    }
    return segments;
  }
}

function readSseData(block) {
  const lines = String(block || "").split("\n");
  const data = [];
  lines.forEach(line => {
    if (line === "data") data.push("");
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  });
  return data.length ? data.join("\n") : null;
}

function parseUpstreamPayload(data) {
  if (data === "[DONE]") return { done: true, content: "" };
  let payload;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    return { done: false, content: "" };
  }

  if (payload && payload.error) {
    const detail = typeof payload.error === "string"
      ? payload.error
      : payload.error.message || payload.error.code || "上游 AI 返回流式错误";
    return { done: false, content: "", error: detail };
  }

  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.delta && choice.delta.content;
  if (typeof content === "string") return { done: false, content };
  if (Array.isArray(content)) {
    return {
      done: false,
      content: content.map(part => part && (part.text || part.content) || "").join("")
    };
  }
  if (choice && typeof choice.text === "string") {
    return { done: false, content: choice.text };
  }
  return { done: false, content: "" };
}

function readNonStreamingReply(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.message && choice.message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => part && (part.text || part.content) || "").join("");
  }
  return "";
}

function parseRequestEvent(value) {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (Buffer.isBuffer(current) || current instanceof Uint8Array) {
      current = Buffer.from(current).toString("utf8");
    }
    if (typeof current === "string") {
      const text = current.trim();
      if (!text) return {};
      try {
        current = JSON.parse(text);
      } catch (error) {
        return {};
      }
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) return {};
    if (typeof current.message === "string") return current;
    if (current.body !== undefined) {
      current = current.body;
      continue;
    }
    if (current.data !== undefined) {
      current = current.data;
      continue;
    }
    return current;
  }
  return current && typeof current === "object" && !Array.isArray(current) ? current : {};
}

module.exports = {
  SentenceSegmenter,
  UpstreamSseParser,
  parseRequestEvent,
  parseUpstreamPayload,
  readNonStreamingReply,
  readSseData
};

/**
 * 云团挂件语音传输使用的 IMA-ADPCM 与 WAV 工具。
 *
 * 设备端只传 4-bit ADPCM；小程序恢复为 16-bit PCM WAV 后交给 ASR。
 * ADPCM 每个字节先放低 4 位样本，再放高 4 位样本。
 */

const INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8
];

const STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function encodeNibble(sample, state) {
  let difference = sample - state.predictor;
  let nibble = 0;
  if (difference < 0) {
    nibble = 8;
    difference = -difference;
  }

  const step = STEP_TABLE[state.index];
  let delta = step >> 3;
  if (difference >= step) {
    nibble |= 4;
    difference -= step;
    delta += step;
  }
  if (difference >= (step >> 1)) {
    nibble |= 2;
    difference -= step >> 1;
    delta += step >> 1;
  }
  if (difference >= (step >> 2)) {
    nibble |= 1;
    delta += step >> 2;
  }

  state.predictor += (nibble & 8) ? -delta : delta;
  state.predictor = clamp(state.predictor, -32768, 32767);
  state.index = clamp(state.index + INDEX_TABLE[nibble], 0, 88);
  return nibble;
}

function decodeNibble(nibble, state) {
  const step = STEP_TABLE[state.index];
  let delta = step >> 3;
  if (nibble & 4) delta += step;
  if (nibble & 2) delta += step >> 1;
  if (nibble & 1) delta += step >> 2;
  state.predictor += (nibble & 8) ? -delta : delta;
  state.predictor = clamp(state.predictor, -32768, 32767);
  state.index = clamp(state.index + INDEX_TABLE[nibble], 0, 88);
  return state.predictor;
}

function encodeImaAdpcm(samples, initialIndex) {
  if (!(samples instanceof Int16Array) || !samples.length) {
    throw new Error("PCM 样本必须是非空 Int16Array");
  }
  const index = clamp(Number.isInteger(initialIndex) ? initialIndex : 0, 0, 88);
  const state = { predictor: samples[0], index };
  const data = new Uint8Array(Math.ceil((samples.length - 1) / 2));
  let outputIndex = 0;
  let lowNibble = 0;

  for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
    const nibble = encodeNibble(samples[sampleIndex], state);
    if ((sampleIndex - 1) % 2 === 0) {
      lowNibble = nibble;
    } else {
      data[outputIndex++] = lowNibble | (nibble << 4);
    }
  }
  if ((samples.length - 1) % 2 === 1) data[outputIndex] = lowNibble;

  return {
    initialPredictor: samples[0],
    initialIndex: index,
    sampleCount: samples.length,
    data
  };
}

function decodeImaAdpcm(data, sampleCount, initialPredictor, initialIndex) {
  const bytes = toUint8Array(data);
  if (!Number.isInteger(sampleCount) || sampleCount < 1) throw new Error("ADPCM 样本数不正确");
  if (bytes.length < Math.ceil((sampleCount - 1) / 2)) throw new Error("ADPCM 数据长度不足");

  const samples = new Int16Array(sampleCount);
  const state = {
    predictor: clamp(initialPredictor | 0, -32768, 32767),
    index: clamp(initialIndex | 0, 0, 88)
  };
  samples[0] = state.predictor;

  let sampleIndex = 1;
  for (let byteIndex = 0; byteIndex < bytes.length && sampleIndex < sampleCount; byteIndex += 1) {
    samples[sampleIndex++] = decodeNibble(bytes[byteIndex] & 0x0F, state);
    if (sampleIndex < sampleCount) {
      samples[sampleIndex++] = decodeNibble((bytes[byteIndex] >> 4) & 0x0F, state);
    }
  }
  return samples;
}

function createImaAdpcmStreamDecoder(initialPredictor, initialIndex) {
  const state = {
    predictor: clamp(initialPredictor | 0, -32768, 32767),
    index: clamp(initialIndex | 0, 0, 88)
  };
  let pendingByte = null;
  let emittedInitial = false;
  let decodedSamples = 0;
  let finished = false;

  function emitInitial(output) {
    if (emittedInitial) return;
    output.push(state.predictor);
    emittedInitial = true;
    decodedSamples += 1;
  }

  function decodePackedByte(packed, output, maximumSamples) {
    if (decodedSamples < maximumSamples) {
      output.push(decodeNibble(packed & 0x0F, state));
      decodedSamples += 1;
    }
    if (decodedSamples < maximumSamples) {
      output.push(decodeNibble((packed >> 4) & 0x0F, state));
      decodedSamples += 1;
    }
  }

  return {
    push(value) {
      if (finished) throw new Error("ADPCM stream is already finished");
      const bytes = toUint8Array(value);
      const output = [];
      emitInitial(output);
      if (!bytes.length) return Int16Array.from(output);

      let offset = 0;
      if (pendingByte !== null) {
        decodePackedByte(pendingByte, output, Number.MAX_SAFE_INTEGER);
        pendingByte = null;
      }
      while (offset + 1 < bytes.length) {
        decodePackedByte(bytes[offset], output, Number.MAX_SAFE_INTEGER);
        offset += 1;
      }
      pendingByte = bytes[offset];
      return Int16Array.from(output);
    },

    finish(sampleCount) {
      if (finished) throw new Error("ADPCM stream is already finished");
      if (!Number.isInteger(sampleCount) || sampleCount < 1) {
        throw new Error("ADPCM stream sample count is invalid");
      }
      finished = true;
      const output = [];
      emitInitial(output);
      if (sampleCount < decodedSamples) {
        throw new Error("ADPCM stream contains more samples than declared");
      }
      if (pendingByte !== null) {
        decodePackedByte(pendingByte, output, sampleCount);
        pendingByte = null;
      }
      if (decodedSamples !== sampleCount) {
        throw new Error("ADPCM stream ended before all samples were decoded");
      }
      return Int16Array.from(output);
    },

    getDecodedSampleCount() {
      return decodedSamples;
    }
  };
}

function createPcmWav(samples, sampleRate) {
  if (!(samples instanceof Int16Array) || !samples.length) throw new Error("没有可写入 WAV 的 PCM 数据");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 48000) {
    throw new Error("WAV 采样率不正确");
  }

  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index], true);
  }
  return buffer;
}

function crc32(value) {
  const bytes = toUint8Array(value);
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concat(parts, length) {
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach(part => {
    const bytes = toUint8Array(part);
    output.set(bytes, offset);
    offset += bytes.length;
  });
  if (offset !== length) throw new Error("音频分片总长度不匹配");
  return output;
}

function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error("音频数据必须是 ArrayBuffer 或 TypedArray");
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

module.exports = {
  encodeImaAdpcm,
  decodeImaAdpcm,
  createImaAdpcmStreamDecoder,
  createPcmWav,
  crc32,
  concat,
  toUint8Array
};

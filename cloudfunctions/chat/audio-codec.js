function extractPcm16Mono(audio, expectedSampleRate) {
  if (!Buffer.isBuffer(audio) || !audio.length) throw new Error("TTS 音频数据为空");
  if (audio.length >= 12 && audio.toString("ascii", 0, 4) === "RIFF" &&
      audio.toString("ascii", 8, 12) === "WAVE") {
    let offset = 12;
    let format = null;
    let data = null;
    while (offset + 8 <= audio.length) {
      const id = audio.toString("ascii", offset, offset + 4);
      const size = audio.readUInt32LE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > audio.length) throw new Error("TTS WAV 分块长度不正确");
      if (id === "fmt " && size >= 16) {
        format = {
          audioFormat: audio.readUInt16LE(start),
          channels: audio.readUInt16LE(start + 2),
          sampleRate: audio.readUInt32LE(start + 4),
          bitsPerSample: audio.readUInt16LE(start + 14)
        };
      } else if (id === "data") data = audio.subarray(start, end);
      offset = end + (size & 1);
    }
    if (!format || !data) throw new Error("TTS WAV 缺少 fmt 或 data 分块");
    if (format.audioFormat !== 1 || format.channels !== 1 ||
        format.sampleRate !== expectedSampleRate || format.bitsPerSample !== 16) {
      throw new Error("TTS WAV 必须是 16kHz、16bit、单声道 PCM");
    }
    audio = data;
  }
  if (audio.length % 2 !== 0) throw new Error("TTS PCM 长度不是 16bit 对齐");
  return audio;
}

function encodePcm16ToImaAdpcm(pcm) {
  const sampleCount = pcm.length / 2;
  const initialPredictor = pcm.readInt16LE(0);
  const state = { predictor: initialPredictor, index: 0 };
  const output = Buffer.alloc(Math.ceil((sampleCount - 1) / 2));
  let outputIndex = 0;
  let lowNibble = 0;
  for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
    const nibble = encodeImaNibble(pcm.readInt16LE(sampleIndex * 2), state);
    if ((sampleIndex - 1) % 2 === 0) lowNibble = nibble;
    else output[outputIndex++] = lowNibble | (nibble << 4);
  }
  if ((sampleCount - 1) % 2 === 1) output[outputIndex] = lowNibble;
  return { initialPredictor, initialIndex: 0, data: output };
}

const IMA_INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8
];
const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767
];

function encodeImaNibble(sample, state) {
  let difference = sample - state.predictor;
  let nibble = 0;
  if (difference < 0) { nibble = 8; difference = -difference; }
  const step = IMA_STEP_TABLE[state.index];
  let delta = step >> 3;
  if (difference >= step) { nibble |= 4; difference -= step; delta += step; }
  if (difference >= (step >> 1)) { nibble |= 2; difference -= step >> 1; delta += step >> 1; }
  if (difference >= (step >> 2)) { nibble |= 1; delta += step >> 2; }
  state.predictor += (nibble & 8) ? -delta : delta;
  state.predictor = Math.max(-32768, Math.min(32767, state.predictor));
  state.index = Math.max(0, Math.min(88, state.index + IMA_INDEX_TABLE[nibble]));
  return nibble;
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

module.exports = { extractPcm16Mono, encodePcm16ToImaAdpcm, crc32 };

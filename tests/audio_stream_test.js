const assert = require("assert");
const codec = require("../miniprogram/utils/yuntuan-audio-codec");

function collect(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Int16Array(length);
  let offset = 0;
  parts.forEach(part => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function runCase(sampleCount, packetSizes) {
  const source = new Int16Array(sampleCount);
  for (let index = 0; index < source.length; index += 1) {
    source[index] = Math.round(
      Math.sin(index / 19) * 12000 + Math.sin(index / 7) * 2500
    );
  }

  const encoded = codec.encodeImaAdpcm(source, 0);
  const expected = codec.decodeImaAdpcm(
    encoded.data,
    encoded.sampleCount,
    encoded.initialPredictor,
    encoded.initialIndex
  );
  const decoder = codec.createImaAdpcmStreamDecoder(
    encoded.initialPredictor,
    encoded.initialIndex
  );
  const decodedParts = [];
  let offset = 0;
  let packetIndex = 0;
  while (offset < encoded.data.length) {
    const size = packetSizes[packetIndex % packetSizes.length];
    const end = Math.min(encoded.data.length, offset + size);
    decodedParts.push(decoder.push(encoded.data.subarray(offset, end)));
    offset = end;
    packetIndex += 1;
  }
  decodedParts.push(decoder.finish(encoded.sampleCount));

  assert.deepStrictEqual(
    Array.from(collect(decodedParts)),
    Array.from(expected),
    `stream decode mismatch for ${sampleCount} samples`
  );
}

runCase(16000, [238, 17, 91, 1]);
runCase(16001, [14, 239, 8]);
runCase(2, [1]);

console.log("audio_stream_test: ok");

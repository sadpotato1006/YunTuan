const assert = require("assert");
const Module = require("module");
const config = require("../miniprogram/config/ble");
const codec = require("../miniprogram/utils/yuntuan-audio-codec");

let valueListener = null;
let sessionId = 0;
let totalChunks = 0;
let expectedSequence = 0;
let receivedBytes = 0;
let playingBeforeEnd = false;
let endReceived = false;

function emit(type, nextSequence) {
  const bytes = new Uint8Array(nextSequence === undefined ? 3 : 5);
  bytes[0] = type;
  bytes[1] = sessionId & 0xFF;
  bytes[2] = sessionId >> 8;
  if (nextSequence !== undefined) {
    bytes[3] = nextSequence & 0xFF;
    bytes[4] = nextSequence >> 8;
  }
  valueListener({ characteristicId: config.UUIDS.ttsStatus, value: bytes.buffer });
}

const bleStub = {
  subscribe() { return () => {}; },
  subscribeValues(listener) { valueListener = listener; return () => {}; },
  negotiateMTU() { return Promise.resolve(247); },
  setCharacteristicNotify() { return Promise.resolve(); },
  getState() { return { connected: true }; },
  writeBuffer(serviceId, characteristicId, value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    if (characteristicId === config.UUIDS.ttsControl && bytes[0] === 0x01) {
      sessionId = bytes[2] | (bytes[3] << 8);
      const encodedBytes = (bytes[12] | (bytes[13] << 8) |
        (bytes[14] << 16) | (bytes[15] << 24)) >>> 0;
      totalChunks = Math.ceil(encodedBytes / bytes[19]);
      emit(0x10, 0);
    } else if (characteristicId === config.UUIDS.ttsData) {
      const sequence = bytes[3] | (bytes[4] << 8);
      assert.strictEqual(sequence, expectedSequence);
      expectedSequence += 1;
      receivedBytes += bytes.length - 5;
      if (receivedBytes >= 3200 && !playingBeforeEnd) {
        playingBeforeEnd = !endReceived;
        emit(0x12);
      }
      if (expectedSequence % 8 === 0 || expectedSequence === totalChunks) {
        emit(0x11, expectedSequence);
      }
    } else if (characteristicId === config.UUIDS.ttsControl && bytes[0] === 0x02) {
      endReceived = true;
      emit(0x13);
    }
    return Promise.resolve();
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "./ble" && parent && /yuntuan-tts\.js$/.test(parent.filename)) return bleStub;
  return originalLoad.call(this, request, parent, isMain);
};

global.wx = {
  base64ToArrayBuffer(value) {
    const source = Buffer.from(value, "base64");
    const output = new Uint8Array(source.length);
    output.set(source);
    return output.buffer;
  }
};

const tts = require("../miniprogram/services/yuntuan-tts");
Module._load = originalLoad;

(async () => {
  const services = [{
    uuid: config.UUIDS.ttsService,
    characteristics: [
      { uuid: config.UUIDS.ttsControl, properties: { write: true } },
      { uuid: config.UUIDS.ttsData, properties: { writeNoResponse: true } },
      { uuid: config.UUIDS.ttsStatus, properties: { notify: true } }
    ]
  }];
  await tts.attach(services);

  const data = new Uint8Array(4000);
  for (let index = 0; index < data.length; index += 1) data[index] = index & 0xFF;
  await tts.play({
    codec: "ima-adpcm",
    sampleRate: 16000,
    bitsPerSample: 16,
    sampleCount: data.length * 2 + 1,
    encodedBytes: data.length,
    initialPredictor: 0,
    initialIndex: 0,
    crc32: codec.crc32(data),
    audioBase64: Buffer.from(data).toString("base64")
  });

  assert.strictEqual(playingBeforeEnd, true);
  assert.strictEqual(endReceived, true);
  assert.strictEqual(tts.getState().phase, "complete");
  console.log("tts_edge_playback_test: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

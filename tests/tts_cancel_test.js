const assert = require("assert");
const Module = require("module");
const config = require("../miniprogram/config/ble");
const codec = require("../miniprogram/utils/yuntuan-audio-codec");

let valueListener = null;
let sessionId = 0;
let abortSent = false;
let resolveDataStarted;
const dataStarted = new Promise(resolve => { resolveDataStarted = resolve; });

function emitReady() {
  const bytes = new Uint8Array([0x10, sessionId & 0xFF, sessionId >> 8, 0, 0]);
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
      emitReady();
    } else if (characteristicId === config.UUIDS.ttsData) {
      resolveDataStarted();
    } else if (characteristicId === config.UUIDS.ttsControl && bytes[0] === 0x03) {
      abortSent = true;
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
    return Uint8Array.from(source).buffer;
  }
};

const tts = require("../miniprogram/services/yuntuan-tts");
Module._load = originalLoad;

(async () => {
  await tts.attach([{
    uuid: config.UUIDS.ttsService,
    characteristics: [
      { uuid: config.UUIDS.ttsControl, properties: { write: true } },
      { uuid: config.UUIDS.ttsData, properties: { writeNoResponse: true } },
      { uuid: config.UUIDS.ttsStatus, properties: { notify: true } }
    ]
  }]);

  const data = Uint8Array.from({ length: 500 }, (_, index) => index & 0xFF);
  const playing = tts.play({
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
  await dataStarted;
  assert.strictEqual(await tts.cancel("页面已隐藏"), true);
  await assert.rejects(playing, error => error.cancelled === true);
  assert.strictEqual(abortSent, true, "取消朗读时应向固件发送 ABORT");
  assert.strictEqual(tts.getState().phase, "idle");
  assert.strictEqual(tts.getState().errorMessage, "");

  console.log("tts cancel tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require("assert");
const Module = require("module");

let transportListener = null;
let valueListener = null;
let stateSnapshot = null;
const writes = [];
let resolveFirstWrite;
const firstWrite = new Promise(resolve => { resolveFirstWrite = resolve; });

const bleMock = {
  subscribe(listener) { transportListener = listener; },
  subscribeValues(listener) { valueListener = listener; },
  getState() { return { connected: true }; },
  writeBuffer(serviceId, characteristicId, packet) {
    writes.push(Array.from(packet));
    return writes.length === 1 ? firstWrite : Promise.resolve();
  },
  negotiateMTU() { return Promise.resolve(247); },
  setCharacteristicNotify() { return Promise.resolve(); }
};

const configMock = {
  UUIDS: {
    audioService: "audio-service",
    audioControl: "audio-control",
    audioData: "audio-data",
    audioStatus: "audio-status"
  }
};

const codecMock = {
  toUint8Array(value) { return value instanceof Uint8Array ? value : new Uint8Array(value); },
  createImaAdpcmStreamDecoder() {
    return { push() { return new Int16Array(0); }, finish() { return new Int16Array(0); } };
  }
};

const realtimeMock = {
  start() { const result = Promise.resolve("测试文字"); result.catch(() => {}); return result; },
  pushPcm() {},
  finish() { return Promise.resolve("测试文字"); },
  cancel() {}
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent && /yuntuan-audio\.js$/.test(parent.filename)) {
    if (request === "./ble") return bleMock;
    if (request === "../config/ble") return configMock;
    if (request === "../utils/yuntuan-audio-codec") return codecMock;
    if (request === "./yuntuan-realtime-asr") return realtimeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const audio = require("../miniprogram/services/yuntuan-audio");
Module._load = originalLoad;
audio.subscribe(state => { stateSnapshot = state; });

function emitStatus(bytes) {
  valueListener({ characteristicId: configMock.UUIDS.audioStatus, value: Uint8Array.from(bytes) });
}

function emitData(sessionId, sequence, final) {
  const packet = new Uint8Array(20);
  packet[0] = 0x20;
  packet[1] = sessionId & 0xff;
  packet[2] = sessionId >> 8;
  packet[3] = sequence & 0xff;
  packet[4] = sequence >> 8;
  packet[5] = final ? 1 : 0;
  for (let index = 6; index < packet.length; index += 1) packet[index] = sequence;
  valueListener({ characteristicId: configMock.UUIDS.audioData, value: packet });
}

function flush() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const meta = new Uint8Array(20);
  meta[0] = 0x11;
  meta[1] = 2;
  meta[2] = 1;
  meta[4] = 1;
  meta[5] = 16;
  meta[6] = 0x80;
  meta[7] = 0x3e;
  meta[19] = 14;
  emitStatus(meta);
  assert.strictEqual(stateSnapshot.phase, "receiving", stateSnapshot.errorMessage);

  for (let sequence = 0; sequence < 8; sequence += 1) emitData(1, sequence, false);
  await flush();
  assert.strictEqual(writes.length, 1, "eight packets should queue one ACK");
  assert.deepStrictEqual(writes[0], [1, 1, 0, 8, 0]);

  emitData(1, 10, false);
  emitData(1, 11, false);
  emitData(1, 12, false);
  await flush();
  assert.strictEqual(writes.length, 1, "repeated out-of-order packets must not flood ACK writes");

  emitStatus([0x13, 1, 0]);
  emitData(1, 8, false);
  assert.strictEqual(stateSnapshot.statusText, "录音已停止，正在上传并识别…");

  const staleEnd = new Uint8Array(15);
  staleEnd[0] = 0x12;
  staleEnd[1] = 2;
  emitStatus(staleEnd);
  emitStatus([0x7f, 2, 0, 4]);
  assert.strictEqual(stateSnapshot.phase, "receiving", "stale terminal status must not kill current session");
  assert.strictEqual(stateSnapshot.sessionId, 1);

  transportListener({ connected: false });
  resolveFirstWrite();
  await flush();
  console.log("audio_session_state_test: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

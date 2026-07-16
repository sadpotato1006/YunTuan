const bleService = require("./ble");
const config = require("../config/ble");
const codec = require("../utils/yuntuan-audio-codec");

const TTS_PROTOCOL_VERSION = 2;
const TTS_CODEC_IMA_ADPCM = 1;
const CONTROL_BEGIN = 0x01;
const CONTROL_END = 0x02;
const CONTROL_ABORT = 0x03;
const DATA_PACKET = 0x20;
const STATUS_READY = 0x10;
const STATUS_ACK = 0x11;
const STATUS_PLAYING = 0x12;
const STATUS_COMPLETE = 0x13;
const STATUS_ERROR = 0x7F;
const ACK_WINDOW = 8;
const MAX_SECONDS = 60;
const BLE_WRITE_TIMEOUT_MS = 3000;

const initialState = {
  supported: false,
  attached: false,
  phase: "idle",
  sessionId: 0,
  progress: 0,
  durationMs: 0,
  mtu: 23,
  statusText: "挂件朗读尚未连接",
  errorMessage: ""
};

let state = Object.assign({}, initialState);
let subscribers = [];
let statusWaiters = [];
let sessionSequence = 0;
let activeSession = null;

bleService.subscribe(handleTransportState);
bleService.subscribeValues(handleValue);

function getState() {
  return Object.assign({}, state);
}

function setState(patch) {
  state = Object.assign({}, state, patch);
  const snapshot = getState();
  subscribers.slice().forEach(listener => listener(snapshot));
}

function subscribe(listener) {
  if (typeof listener !== "function") throw new Error("挂件朗读状态监听器必须是函数");
  subscribers.push(listener);
  listener(getState());
  return function unsubscribe() {
    subscribers = subscribers.filter(item => item !== listener);
  };
}

function handleTransportState(transport) {
  if (transport.connected) return;
  const wasActive = Boolean(activeSession);
  activeSession = null;
  rejectStatusWaiters(new Error("挂件连接已断开"));
  setState({
    attached: false,
    phase: wasActive ? "error" : "idle",
    progress: 0,
    statusText: wasActive ? "朗读因连接断开而停止" : "挂件朗读尚未连接",
    errorMessage: wasActive ? "挂件连接已断开" : ""
  });
}

async function attach(services) {
  const required = [config.UUIDS.ttsControl, config.UUIDS.ttsData, config.UUIDS.ttsStatus];
  const available = required.every(characteristicId =>
    findCharacteristic(services, config.UUIDS.ttsService, characteristicId)
  );
  if (!available) {
    activeSession = null;
    setState(Object.assign({}, initialState, { statusText: "当前挂件固件不支持朗读" }));
    return false;
  }

  const dataCharacteristic = findCharacteristic(services, config.UUIDS.ttsService, config.UUIDS.ttsData);
  if (!dataCharacteristic.properties || !dataCharacteristic.properties.writeNoResponse) {
    throw new Error("挂件 TTS Data 必须支持 Write Without Response");
  }

  setState({ supported: true, attached: false, statusText: "正在初始化挂件朗读…", errorMessage: "" });
  const mtu = await bleService.negotiateMTU(247, "writeNoResponse");
  await bleService.setCharacteristicNotify(config.UUIDS.ttsService, config.UUIDS.ttsStatus, true);
  setState({
    supported: true,
    attached: true,
    phase: "idle",
    mtu,
    statusText: mtu < 100
      ? `挂件朗读已就绪，但当前 MTU ${mtu} 会使传输较慢`
      : `挂件朗读已就绪（MTU ${mtu}）`,
    errorMessage: ""
  });
  return true;
}

function handleValue(result) {
  if (!result || !result.value || !sameUuid(result.characteristicId, config.UUIDS.ttsStatus)) return;
  const bytes = codec.toUint8Array(result.value);
  if (bytes.length < 3) return;
  const status = {
    type: bytes[0],
    sessionId: readUint16(bytes, 1),
    nextSequence: bytes.length >= 5 ? readUint16(bytes, 3) : null,
    errorCode: bytes.length >= 4 ? bytes[3] : 0
  };
  resolveStatusWaiters(status);
  if (!activeSession || status.sessionId !== activeSession.id) return;

  if (status.type === STATUS_ERROR) {
    const error = new Error(getDeviceErrorMessage(status.errorCode));
    rejectStatusWaiters(error);
    activeSession.error = error;
    setState({ phase: "error", statusText: "挂件朗读失败", errorMessage: error.message });
  } else if (status.type === STATUS_PLAYING) {
    activeSession.playing = true;
    setState({ phase: "playing", statusText: "云团正在朗读…", errorMessage: "" });
  } else if (status.type === STATUS_COMPLETE) {
    activeSession.complete = true;
    setState({ phase: "complete", progress: 100, statusText: "云团朗读完成", errorMessage: "" });
  }
}

async function play(payload) {
  if (!state.attached || !bleService.getState().connected) throw new Error("挂件朗读尚未连接");
  if (activeSession) throw new Error("挂件正在播放上一条回复");
  const audio = validatePayload(payload);
  const id = nextSessionId();
  const chunkPayload = Math.max(15, Math.min(239, state.mtu - 8));
  const totalChunks = Math.ceil(audio.data.length / chunkPayload);
  activeSession = { id, error: null, playing: false, complete: false };
  setState({
    phase: "sending",
    sessionId: id,
    progress: 0,
    durationMs: Math.round(audio.sampleCount * 1000 / audio.sampleRate),
    statusText: "正在把云团语音发送给挂件 0%",
    errorMessage: ""
  });

  try {
    const readyPromise = waitForStatus(
      status => status.sessionId === id && status.type === STATUS_READY,
      3000,
      "等待挂件准备播放超时"
    );
    readyPromise.catch(() => {});
    await sendControl(createBeginPacket(id, audio, chunkPayload));
    await readyPromise;

    const playingPromise = waitForStatus(
      status => status.sessionId === id && (status.type === STATUS_PLAYING || status.type === STATUS_ERROR),
      Math.max(6000, state.durationMs + 4000),
      "等待挂件开始播放超时"
    );
    playingPromise.catch(() => {});

    let sequence = 0;
    while (sequence < totalChunks) {
      const windowEnd = Math.min(totalChunks, sequence + ACK_WINDOW);
      const ackPromise = waitForStatus(
        status => status.sessionId === id && (status.type === STATUS_ACK || status.type === STATUS_ERROR),
        3500,
        "等待挂件接收语音超时"
      );
      ackPromise.catch(() => {});
      for (let current = sequence; current < windowEnd; current += 1) {
        const offset = current * chunkPayload;
        const part = audio.data.subarray(offset, Math.min(audio.data.length, offset + chunkPayload));
        await sendData(createDataPacket(id, current, part));
      }
      const ack = await ackPromise;
      if (activeSession && activeSession.error) throw activeSession.error;
      if (ack.type === STATUS_ERROR) throw new Error(getDeviceErrorMessage(ack.errorCode));
      if (ack.nextSequence === null || ack.nextSequence > totalChunks) {
        throw new Error("挂件返回的朗读 ACK 不正确");
      }
      if (ack.nextSequence <= sequence && sequence !== 0) throw new Error("挂件没有继续接收朗读数据");
      sequence = ack.nextSequence;
      const progress = Math.min(100, Math.floor(sequence * 100 / totalChunks));
      if (activeSession && activeSession.playing) {
        setState({ progress, phase: "playing", statusText: "云团正在朗读…" });
      } else {
        setState({ progress, statusText: `正在把云团语音发送给挂件 ${progress}%` });
      }
    }

    const completePromise = waitForStatus(
      status => status.sessionId === id && (status.type === STATUS_COMPLETE || status.type === STATUS_ERROR),
      state.durationMs + 8000,
      "等待挂件播放完成超时"
    );
    completePromise.catch(() => {});
    await sendControl(createEndPacket(id, audio.crc32));
    const playing = await playingPromise;
    if (playing.type === STATUS_ERROR) throw new Error(getDeviceErrorMessage(playing.errorCode));

    const complete = await completePromise;
    if (complete.type === STATUS_ERROR) throw new Error(getDeviceErrorMessage(complete.errorCode));
    return getState();
  } catch (error) {
    if (bleService.getState().connected) {
      sendControl(createSessionControl(CONTROL_ABORT, id)).catch(() => {});
    }
    setState({ phase: "error", progress: 0, statusText: "挂件朗读失败", errorMessage: error.message });
    throw error;
  } finally {
    activeSession = null;
    rejectStatusWaiters(new Error("朗读会话已经结束"));
  }
}

function validatePayload(payload) {
  if (!payload || payload.codec !== "ima-adpcm") throw new Error("云端朗读编码格式不正确");
  const sampleRate = Number(payload.sampleRate);
  const sampleCount = Number(payload.sampleCount);
  const encodedBytes = Number(payload.encodedBytes);
  const initialPredictor = Number(payload.initialPredictor);
  const initialIndex = Number(payload.initialIndex);
  const expectedCrc = Number(payload.crc32) >>> 0;
  if (sampleRate !== 16000 || payload.bitsPerSample !== 16 || !Number.isInteger(sampleCount) ||
      sampleCount < 1 || sampleCount > sampleRate * MAX_SECONDS) {
    throw new Error("云端朗读采样参数不正确");
  }
  if (!Number.isInteger(initialPredictor) || initialPredictor < -32768 || initialPredictor > 32767 ||
      !Number.isInteger(initialIndex) || initialIndex < 0 || initialIndex > 88) {
    throw new Error("云端朗读 ADPCM 初始状态不正确");
  }
  const data = base64ToBytes(payload.audioBase64);
  if (!Number.isInteger(encodedBytes) || encodedBytes !== data.length ||
      encodedBytes !== Math.ceil((sampleCount - 1) / 2)) {
    throw new Error("云端朗读压缩长度不正确");
  }
  if (codec.crc32(data) !== expectedCrc) throw new Error("云端朗读 CRC32 校验失败");
  return { sampleRate, sampleCount, initialPredictor, initialIndex, crc32: expectedCrc, data };
}

function createBeginPacket(sessionId, audio, chunkPayload) {
  const packet = new Uint8Array(20);
  packet[0] = CONTROL_BEGIN;
  packet[1] = TTS_PROTOCOL_VERSION;
  writeUint16(packet, 2, sessionId);
  packet[4] = TTS_CODEC_IMA_ADPCM;
  packet[5] = 16;
  writeUint16(packet, 6, audio.sampleRate);
  writeUint32(packet, 8, audio.sampleCount);
  writeUint32(packet, 12, audio.data.length);
  writeUint16(packet, 16, audio.initialPredictor & 0xFFFF);
  packet[18] = audio.initialIndex;
  packet[19] = chunkPayload;
  return packet;
}

function createDataPacket(sessionId, sequence, payload) {
  const packet = new Uint8Array(5 + payload.length);
  packet[0] = DATA_PACKET;
  writeUint16(packet, 1, sessionId);
  writeUint16(packet, 3, sequence);
  packet.set(payload, 5);
  return packet;
}

function createEndPacket(sessionId, expectedCrc) {
  const packet = new Uint8Array(7);
  packet[0] = CONTROL_END;
  writeUint16(packet, 1, sessionId);
  writeUint32(packet, 3, expectedCrc);
  return packet;
}

function createSessionControl(command, sessionId) {
  const packet = new Uint8Array(3);
  packet[0] = command;
  writeUint16(packet, 1, sessionId);
  return packet;
}

function sendControl(packet) {
  return withTimeout(
    bleService.writeBuffer(config.UUIDS.ttsService, config.UUIDS.ttsControl, packet, "write"),
    BLE_WRITE_TIMEOUT_MS,
    "向挂件发送朗读控制指令超时"
  );
}

function sendData(packet) {
  return withTimeout(
    bleService.writeBuffer(
      config.UUIDS.ttsService,
      config.UUIDS.ttsData,
      packet,
      "writeNoResponse",
      { quiet: true }
    ),
    BLE_WRITE_TIMEOUT_MS,
    "向挂件发送朗读音频超时"
  );
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(message));
    }, timeoutMs);
    Promise.resolve(promise).then(value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForStatus(predicate, timeout, message) {
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate,
      resolve,
      reject,
      timer: setTimeout(() => {
        statusWaiters = statusWaiters.filter(item => item !== waiter);
        reject(new Error(message));
      }, timeout)
    };
    statusWaiters.push(waiter);
  });
}

function resolveStatusWaiters(status) {
  const matched = statusWaiters.filter(waiter => waiter.predicate(status));
  if (!matched.length) return;
  statusWaiters = statusWaiters.filter(waiter => !matched.includes(waiter));
  matched.forEach(waiter => {
    clearTimeout(waiter.timer);
    waiter.resolve(status);
  });
}

function rejectStatusWaiters(error) {
  const waiters = statusWaiters;
  statusWaiters = [];
  waiters.forEach(waiter => {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  });
}

function base64ToBytes(value) {
  if (typeof value !== "string" || !value) throw new Error("云端朗读数据为空");
  if (typeof wx === "undefined" || typeof wx.base64ToArrayBuffer !== "function") {
    throw new Error("当前微信版本不支持朗读音频解码");
  }
  return new Uint8Array(wx.base64ToArrayBuffer(value));
}

function getDeviceErrorMessage(code) {
  const messages = {
    1: "挂件没有足够内存接收朗读音频",
    2: "挂件收到的朗读参数不正确",
    3: "挂件朗读分片丢失或乱序",
    4: "挂件朗读 CRC32 校验失败",
    5: "挂件扬声器初始化失败",
    6: "挂件当前正在录音或播放",
    7: "挂件朗读会话超时"
  };
  return messages[code] || `挂件朗读错误（${code}）`;
}

function findCharacteristic(services, serviceId, characteristicId) {
  const service = (services || []).find(item => sameUuid(item.uuid, serviceId));
  if (!service) return null;
  return (service.characteristics || []).find(item => sameUuid(item.uuid, characteristicId)) || null;
}

function sameUuid(first, second) {
  return String(first || "").replace(/-/g, "").toUpperCase() ===
    String(second || "").replace(/-/g, "").toUpperCase();
}

function nextSessionId() {
  sessionSequence = sessionSequence >= 0xFFFF ? 1 : sessionSequence + 1;
  return sessionSequence;
}

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >> 8) & 0xFF;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
  bytes[offset + 2] = (value >>> 16) & 0xFF;
  bytes[offset + 3] = (value >>> 24) & 0xFF;
}

module.exports = { attach, play, getState, subscribe };

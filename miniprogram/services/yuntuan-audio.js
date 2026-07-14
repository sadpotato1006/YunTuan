const bleService = require("./ble");
const config = require("../config/ble");
const codec = require("../utils/yuntuan-audio-codec");

const AUDIO_PROTOCOL_VERSION = 1;
const AUDIO_CODEC_IMA_ADPCM = 1;
const STATUS_META = 0x11;
const STATUS_RECORDING = 0x10;
const STATUS_END = 0x12;
const STATUS_ERROR = 0x7F;
const DATA_PACKET = 0x20;
const CONTROL_ACK = 0x01;
const CONTROL_COMPLETE = 0x02;
const CONTROL_ABORT = 0x03;
const ACK_WINDOW = 8;
const MAX_RECORD_SECONDS = 15;

const initialState = {
  supported: false,
  attached: false,
  phase: "idle",
  sessionId: 0,
  progress: 0,
  durationMs: 0,
  mtu: 23,
  statusText: "挂件语音尚未连接",
  errorMessage: ""
};

let state = Object.assign({}, initialState);
let subscribers = [];
let completionSubscribers = [];
let pendingCompletions = [];
let session = null;
let controlQueue = Promise.resolve();
let finishing = false;

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
  if (typeof listener !== "function") throw new Error("挂件语音状态监听器必须是函数");
  subscribers.push(listener);
  listener(getState());
  return function unsubscribe() {
    subscribers = subscribers.filter(item => item !== listener);
  };
}

function subscribeCompleted(listener) {
  if (typeof listener !== "function") throw new Error("挂件录音监听器必须是函数");
  completionSubscribers.push(listener);
  if (pendingCompletions.length) {
    const queued = pendingCompletions;
    pendingCompletions = [];
    setTimeout(() => queued.forEach(item => listener(item)), 0);
  }
  return function unsubscribe() {
    completionSubscribers = completionSubscribers.filter(item => item !== listener);
  };
}

function handleTransportState(transport) {
  if (transport.connected) return;
  const wasActive = session || state.phase === "recording" || state.phase === "receiving";
  session = null;
  finishing = false;
  setState({
    attached: false,
    phase: wasActive ? "waiting" : "idle",
    progress: 0,
    statusText: wasActive ? "连接已断开，重连后挂件会重新发送录音" : "挂件语音尚未连接",
    errorMessage: ""
  });
}

async function attach(services) {
  const required = [config.UUIDS.audioControl, config.UUIDS.audioData, config.UUIDS.audioStatus];
  const available = required.every(characteristicId =>
    findCharacteristic(services, config.UUIDS.audioService, characteristicId)
  );
  if (!available) {
    session = null;
    setState(Object.assign({}, initialState, {
      statusText: "当前挂件固件不支持语音传输"
    }));
    return false;
  }

  setState({ supported: true, attached: false, statusText: "正在初始化挂件语音…", errorMessage: "" });
  const mtu = await bleService.negotiateMTU(247);
  await bleService.setCharacteristicNotify(
    config.UUIDS.audioService,
    config.UUIDS.audioStatus,
    true
  );
  await bleService.setCharacteristicNotify(
    config.UUIDS.audioService,
    config.UUIDS.audioData,
    true
  );
  setState({
    attached: true,
    mtu,
    phase: "idle",
    statusText: "挂件语音已就绪，短按 PTT 键后说话",
    errorMessage: ""
  });
  return true;
}

function handleValue(result) {
  if (!result || !result.value) return;
  try {
    if (sameUuid(result.characteristicId, config.UUIDS.audioStatus)) {
      handleStatus(codec.toUint8Array(result.value));
    } else if (sameUuid(result.characteristicId, config.UUIDS.audioData)) {
      handleData(codec.toUint8Array(result.value));
    }
  } catch (error) {
    failSession(error);
  }
}

function handleStatus(bytes) {
  if (!bytes.length) throw new Error("收到空的挂件语音状态");
  if (bytes[0] === STATUS_RECORDING) {
    if (bytes.length !== 4) throw new Error("挂件录音状态长度错误");
    const sessionId = readUint16(bytes, 1);
    session = null;
    finishing = false;
    setState({
      phase: "recording",
      sessionId,
      progress: 0,
      durationMs: 0,
      statusText: "挂件正在录音，请说话…",
      errorMessage: ""
    });
    return;
  }

  if (bytes[0] === STATUS_META) {
    beginSession(bytes);
    return;
  }

  if (bytes[0] === STATUS_END) {
    if (bytes.length !== 7) throw new Error("挂件录音结束状态长度错误");
    const sessionId = readUint16(bytes, 1);
    const expectedCrc = readUint32(bytes, 3);
    if (!session || session.id !== sessionId) throw new Error("挂件录音会话不匹配");
    if (!finishing) {
      finishing = true;
      finishSession(expectedCrc).catch(failSession);
    }
    return;
  }

  if (bytes[0] === STATUS_ERROR) {
    if (bytes.length < 4) throw new Error("挂件语音错误状态长度错误");
    const errorCode = bytes[3];
    throw new Error(getDeviceErrorMessage(errorCode));
  }
}

function beginSession(bytes) {
  if (bytes.length !== 20) throw new Error("挂件录音元数据必须为 20 字节");
  if (bytes[1] !== AUDIO_PROTOCOL_VERSION) throw new Error("挂件语音协议版本不兼容");

  const id = readUint16(bytes, 2);
  const audioCodec = bytes[4];
  const bitsPerSample = bytes[5];
  const sampleRate = readUint16(bytes, 6);
  const sampleCount = readUint32(bytes, 8);
  const encodedBytes = readUint32(bytes, 12);
  const initialPredictor = readInt16(bytes, 16);
  const initialIndex = bytes[18];
  const chunkPayload = bytes[19];

  if (!id || audioCodec !== AUDIO_CODEC_IMA_ADPCM || bitsPerSample !== 16) {
    throw new Error("挂件录音编码参数不受支持");
  }
  if (sampleRate !== 16000 || !sampleCount || sampleCount > sampleRate * MAX_RECORD_SECONDS) {
    throw new Error("挂件录音采样参数不正确");
  }
  if (!encodedBytes || encodedBytes !== Math.ceil((sampleCount - 1) / 2)) {
    throw new Error("挂件录音压缩长度不正确");
  }
  if (!chunkPayload || chunkPayload > 239 || initialIndex > 88) {
    throw new Error("挂件录音分包参数不正确");
  }

  const totalChunks = Math.ceil(encodedBytes / chunkPayload);
  session = {
    id,
    sampleRate,
    sampleCount,
    encodedBytes,
    initialPredictor,
    initialIndex,
    chunkPayload,
    totalChunks,
    expectedSequence: 0,
    receivedBytes: 0,
    parts: []
  };
  finishing = false;
  setState({
    phase: "receiving",
    sessionId: id,
    progress: 0,
    durationMs: Math.round(sampleCount * 1000 / sampleRate),
    statusText: "正在接收挂件录音 0%",
    errorMessage: ""
  });
}

function handleData(bytes) {
  if (bytes.length < 6 || bytes[0] !== DATA_PACKET) throw new Error("挂件录音分片格式错误");
  if (!session) return;

  const sessionId = readUint16(bytes, 1);
  const sequence = readUint16(bytes, 3);
  if (sessionId !== session.id) return;
  const payload = bytes.slice(5);
  if (!payload.length || payload.length > session.chunkPayload) throw new Error("挂件录音分片长度错误");

  if (sequence === session.expectedSequence) {
    session.parts.push(payload);
    session.receivedBytes += payload.length;
    session.expectedSequence += 1;
    if (session.receivedBytes > session.encodedBytes) throw new Error("挂件录音数据超出声明长度");

    const shouldAck = session.expectedSequence % ACK_WINDOW === 0 ||
      session.expectedSequence === session.totalChunks;
    if (shouldAck) sendAck(session.id, session.expectedSequence);

    if (shouldAck || session.expectedSequence === 1) {
      const progress = Math.min(100, Math.floor(session.receivedBytes * 100 / session.encodedBytes));
      setState({ progress, statusText: `正在接收挂件录音 ${progress}%` });
    }
    return;
  }

  // 丢包或重发时告诉设备“下一个真正需要的序号”，设备从该位置继续。
  sendAck(session.id, session.expectedSequence);
}

async function finishSession(expectedCrc) {
  const current = session;
  if (!current) throw new Error("没有可完成的挂件录音会话");
  if (current.expectedSequence !== current.totalChunks || current.receivedBytes !== current.encodedBytes) {
    throw new Error("挂件录音尚未接收完整");
  }

  setState({ phase: "decoding", progress: 100, statusText: "正在整理挂件录音…" });
  const compressed = codec.concat(current.parts, current.encodedBytes);
  if (codec.crc32(compressed) !== expectedCrc) throw new Error("挂件录音 CRC32 校验失败");

  const pcm = codec.decodeImaAdpcm(
    compressed,
    current.sampleCount,
    current.initialPredictor,
    current.initialIndex
  );
  const wav = codec.createPcmWav(pcm, current.sampleRate);
  const filePath = `${wx.env.USER_DATA_PATH}/yuntuan-voice-${current.id}-${Date.now()}.wav`;
  await writeFile(filePath, wav);
  try {
    await sendControl(createSessionControl(CONTROL_COMPLETE, current.id));
  } catch (error) {
    // 文件已经完整落盘，不能因为释放设备缓存的确认写失败而丢掉用户这句话。
    console.warn("确认挂件录音完成失败，设备会在超时后自行释放缓存：", error);
  }

  const completed = {
    sessionId: current.id,
    filePath,
    voiceFormat: "wav",
    durationMs: Math.round(current.sampleCount * 1000 / current.sampleRate)
  };
  session = null;
  finishing = false;
  setState({
    phase: "complete",
    progress: 100,
    statusText: "挂件录音接收完成，正在识别…",
    errorMessage: ""
  });
  if (!completionSubscribers.length) {
    pendingCompletions.push(completed);
    while (pendingCompletions.length > 2) {
      removeFile(pendingCompletions.shift().filePath);
    }
  } else {
    completionSubscribers.slice().forEach(listener => {
      try {
        listener(completed);
      } catch (error) {
        console.error("处理挂件录音失败：", error);
      }
    });
  }
}

function sendAck(sessionId, nextSequence) {
  const packet = new Uint8Array(5);
  packet[0] = CONTROL_ACK;
  writeUint16(packet, 1, sessionId);
  writeUint16(packet, 3, nextSequence);
  sendControl(packet).catch(failSession);
}

function createSessionControl(command, sessionId) {
  const packet = new Uint8Array(3);
  packet[0] = command;
  writeUint16(packet, 1, sessionId);
  return packet;
}

function sendControl(packet) {
  controlQueue = controlQueue.catch(() => {}).then(() => bleService.writeBuffer(
    config.UUIDS.audioService,
    config.UUIDS.audioControl,
    packet,
    "write"
  ));
  return controlQueue;
}

function failSession(error) {
  const message = error && error.message ? error.message : "挂件录音传输失败";
  const sessionId = session && session.id;
  session = null;
  finishing = false;
  if (sessionId && bleService.getState().connected) {
    sendControl(createSessionControl(CONTROL_ABORT, sessionId)).catch(() => {});
  }
  setState({ phase: "error", progress: 0, statusText: "挂件录音处理失败", errorMessage: message });
}

function getDeviceErrorMessage(code) {
  const messages = {
    1: "挂件麦克风初始化失败",
    2: "挂件没有检测到有效语音",
    3: "挂件录音缓冲区已满",
    4: "挂件语音传输超时",
    5: "小程序尚未订阅挂件语音"
  };
  return messages[code] || `挂件语音错误（${code}）`;
}

function writeFile(filePath, data) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().writeFile({
      filePath,
      data,
      success: resolve,
      fail: error => reject(new Error(error.errMsg || "保存挂件录音失败"))
    });
  });
}

function removeFile(filePath) {
  if (!filePath || typeof wx === "undefined" || !wx.getFileSystemManager) return;
  wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
}

function markReady() {
  if (!state.attached || (state.phase !== "complete" && state.phase !== "error")) return;
  setState({
    phase: "idle",
    progress: 0,
    statusText: "挂件语音已就绪，短按 PTT 键后说话",
    errorMessage: ""
  });
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

function readUint16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readInt16(bytes, offset) {
  const value = readUint16(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readUint32(bytes, offset) {
  return (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

function writeUint16(bytes, offset, value) {
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >> 8) & 0xFF;
}

module.exports = {
  attach,
  getState,
  subscribe,
  subscribeCompleted,
  removeFile,
  markReady
};

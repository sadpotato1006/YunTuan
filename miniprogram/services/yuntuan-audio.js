const bleService = require("./ble");
const config = require("../config/ble");
const codec = require("../utils/yuntuan-audio-codec");
const realtimeAsr = require("./yuntuan-realtime-asr");
const diagnostics = require("./diagnostics");
const { withTimeout, getDeviceErrorMessage, writeFile, removeFile, findCharacteristic, sameUuid, readUint16, readInt16, readUint32, writeUint16 } = require("./yuntuan-audio-helpers");

const AUDIO_PROTOCOL_VERSION = 2;
const AUDIO_CODEC_IMA_ADPCM = 1;
const STATUS_META = 0x11;
const STATUS_RECORDING = 0x10;
const STATUS_END = 0x12;
const STATUS_CAPTURE_STOPPED = 0x13;
const STATUS_ERROR = 0x7F;
const DATA_PACKET = 0x20;
const CONTROL_ACK = 0x01;
const CONTROL_COMPLETE = 0x02;
const CONTROL_ABORT = 0x03;
const ACK_WINDOW = 8;
const MAX_RECORD_SECONDS = 15;
const MAX_ENCODED_BYTES = 16000 * MAX_RECORD_SECONDS / 2;
const AUDIO_INACTIVITY_TIMEOUT_MS = 6000;
const AUDIO_SESSION_TIMEOUT_MS = 30000;
const AUDIO_CONTROL_WRITE_TIMEOUT_MS = 1500;
const ACK_REPEAT_SUPPRESS_MS = 400;

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
let recordingStartedAt = 0;
let audioActivityTimer = null;
let audioSessionTimer = null;
let pendingAck = null;
let ackPumpRunning = false;

bleService.subscribe(handleTransportState);
bleService.subscribeValues(handleValue);

function getState() {
  return Object.assign({}, state);
}

function setState(patch) {
  const previousPhase = state.phase;
  state = Object.assign({}, state, patch);
  if (patch && patch.phase && patch.phase !== previousPhase) {
    diagnostics.record("voice", "phase", {
      from: previousPhase,
      to: patch.phase,
      session: state.sessionId,
      progress: state.progress,
      mtu: state.mtu
    }, patch.phase === "error" ? "error" : "info");
  }
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
  clearAudioTimers();
  const wasActive = session || state.phase === "recording" || state.phase === "receiving";
  if (session) realtimeAsr.cancel(session.id, "BLE 连接已断开");
  pendingAck = null;
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
    clearAudioTimers();
    session = null;
    setState(Object.assign({}, initialState, {
      statusText: "当前挂件固件不支持语音传输"
    }));
    return false;
  }

  setState({ supported: true, attached: false, statusText: "正在初始化挂件语音…", errorMessage: "" });
  const mtu = await bleService.negotiateMTU(247, "write");
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
    statusText: mtu < 100
      ? `挂件语音已就绪，但当前 MTU ${mtu} 会使传输较慢`
      : `挂件语音已就绪（MTU ${mtu}），短按 PTT 键后说话`,
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
    if (session) realtimeAsr.cancel(session.id, "新的硬件录音已经开始");
    recordingStartedAt = Date.now();
    startAudioSessionTimer();
    touchAudioActivity();
    pendingAck = null;
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

  if (bytes[0] === STATUS_CAPTURE_STOPPED) {
    if (bytes.length !== 3) throw new Error("挂件停止录音状态长度错误");
    const sessionId = readUint16(bytes, 1);
    if (state.sessionId && state.sessionId !== sessionId) {
      console.warn("忽略旧挂件停止录音状态：", sessionId);
      return;
    }
    touchAudioActivity();
    if (session && session.id === sessionId) session.captureStopped = true;
    setState({
      phase: "receiving",
      sessionId,
      statusText: "录音已停止，正在上传并识别…",
      errorMessage: ""
    });
    return;
  }

  if (bytes[0] === STATUS_END) {
    if (bytes.length !== 15) throw new Error("挂件录音结束状态长度错误");
    const sessionId = readUint16(bytes, 1);
    const sampleCount = readUint32(bytes, 3);
    const encodedBytes = readUint32(bytes, 7);
    const expectedCrc = readUint32(bytes, 11);
    if (!session || session.id !== sessionId) {
      console.warn("忽略旧挂件录音结束状态：", sessionId);
      return;
    }
    if (!finishing) {
      clearAudioTimers();
      finishing = true;
      finishSession(sampleCount, encodedBytes, expectedCrc).catch(failSession);
    }
    return;
  }

  if (bytes[0] === STATUS_ERROR) {
    if (bytes.length !== 4) throw new Error("挂件语音错误状态长度错误");
    const sessionId = readUint16(bytes, 1);
    const activeSessionId = session ? session.id : state.sessionId;
    const active = state.phase === "recording" || state.phase === "receiving";
    if (!active || (activeSessionId && activeSessionId !== sessionId)) {
      console.warn("忽略旧挂件语音错误状态：", sessionId);
      return;
    }
    const errorCode = bytes[3];
    if (session) realtimeAsr.cancel(session.id, getDeviceErrorMessage(errorCode));
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
  const announcedSampleCount = readUint32(bytes, 8);
  const announcedEncodedBytes = readUint32(bytes, 12);
  const initialPredictor = readInt16(bytes, 16);
  const initialIndex = bytes[18];
  const chunkPayload = bytes[19];

  if (!id || audioCodec !== AUDIO_CODEC_IMA_ADPCM || bitsPerSample !== 16) {
    throw new Error("挂件录音编码参数不受支持");
  }
  if (sampleRate !== 16000 || announcedSampleCount !== 0 || announcedEncodedBytes !== 0) {
    throw new Error("挂件录音采样参数不正确");
  }
  if (chunkPayload < 14 || chunkPayload > 239 || initialIndex > 88) {
    throw new Error("挂件录音分包参数不正确");
  }

  if (session) realtimeAsr.cancel(session.id, "硬件重新开始发送录音流");
  const transferStartedAt = Date.now();
  startAudioSessionTimer();
  touchAudioActivity();
  pendingAck = null;
  session = {
    id,
    sampleRate,
    initialPredictor,
    initialIndex,
    chunkPayload,
    expectedSequence: 0,
    receivedBytes: 0,
    parts: [],
    finalPacketSeen: false,
    captureStopped: false,
    streamDecoder: codec.createImaAdpcmStreamDecoder(initialPredictor, initialIndex),
    realtimeTranscriptPromise: realtimeAsr.start(id),
    recordingStartedAt: recordingStartedAt || transferStartedAt,
    transferStartedAt,
    lastAckRequested: -1,
    lastAckRequestedAt: 0
  };
  finishing = false;
  setState({
    phase: "receiving",
    sessionId: id,
    progress: 0,
    durationMs: 0,
    statusText: "正在录音、上传并实时识别…",
    errorMessage: ""
  });
}

function handleData(bytes) {
  if (bytes.length < 7 || bytes[0] !== DATA_PACKET) throw new Error("挂件录音分片格式错误");
  if (!session) return;

  const sessionId = readUint16(bytes, 1);
  const sequence = readUint16(bytes, 3);
  const flags = bytes[5];
  if (sessionId !== session.id) return;
  touchAudioActivity();
  if (flags & ~0x01) throw new Error("挂件录音分片标志不正确");
  const isFinalPacket = Boolean(flags & 0x01);
  const payload = bytes.slice(6);
  if (!payload.length || payload.length > session.chunkPayload) throw new Error("挂件录音分片长度错误");
  if (!isFinalPacket && payload.length !== session.chunkPayload) throw new Error("挂件录音流提前出现短分片");

  if (sequence === session.expectedSequence) {
    session.parts.push(payload);
    session.receivedBytes += payload.length;
    session.expectedSequence += 1;
    if (session.receivedBytes > MAX_ENCODED_BYTES) throw new Error("挂件录音超过最长时限");
    if (isFinalPacket) {
      session.finalPacketSeen = true;
      // Final is authoritative evidence that microphone capture has ended,
      // even if the separate CAPTURE_STOPPED indication was lost.
      session.captureStopped = true;
    }

    const pcm = session.streamDecoder.push(payload);
    if (pcm.length) realtimeAsr.pushPcm(session.id, pcm);

    const shouldAck = session.expectedSequence % ACK_WINDOW === 0 ||
      isFinalPacket;
    if (shouldAck) sendAck(session.id, session.expectedSequence);

    if (shouldAck || session.expectedSequence === 1) {
      const durationMs = Math.round((1 + session.receivedBytes * 2) * 1000 / session.sampleRate);
      const progress = Math.min(99, Math.floor(durationMs * 100 / (MAX_RECORD_SECONDS * 1000)));
      setState({
        progress,
        durationMs,
        statusText: session.captureStopped
          ? "录音已停止，正在上传并识别…"
          : "正在录音、上传并实时识别…"
      });
    }
    return;
  }

  // 丢包或重发时告诉设备“下一个真正需要的序号”，设备从该位置继续。
  sendAck(session.id, session.expectedSequence);
}

async function finishSession(sampleCount, encodedBytes, expectedCrc) {
  clearAudioTimers();
  const current = session;
  const recordingFinishedAt = Date.now();
  if (!current) throw new Error("没有可完成的挂件录音会话");
  if (!sampleCount || sampleCount > current.sampleRate * MAX_RECORD_SECONDS ||
      encodedBytes !== Math.ceil((sampleCount - 1) / 2) ||
      encodedBytes > MAX_ENCODED_BYTES) {
    throw new Error("挂件录音结束参数不正确");
  }
  const totalChunks = Math.ceil(encodedBytes / current.chunkPayload);
  if (!current.finalPacketSeen || current.expectedSequence !== totalChunks ||
      current.receivedBytes !== encodedBytes) {
    throw new Error("挂件录音尚未接收完整");
  }

  setState({ phase: "decoding", progress: 100, statusText: "正在整理挂件录音…" });
  const compressed = codec.concat(current.parts, encodedBytes);
  if (codec.crc32(compressed) !== expectedCrc) throw new Error("挂件录音 CRC32 校验失败");

  const finalPcm = current.streamDecoder.finish(sampleCount);
  if (finalPcm.length) realtimeAsr.pushPcm(current.id, finalPcm);
  realtimeAsr.finish(current.id).catch(() => {});
  const realtimeTranscriptPromise = current.realtimeTranscriptPromise;

  const pcm = codec.decodeImaAdpcm(
    compressed,
    sampleCount,
    current.initialPredictor,
    current.initialIndex
  );
  const wav = codec.createPcmWav(pcm, current.sampleRate);
  let filePath = "";
  let audioBase64 = "";
  if (typeof wx.arrayBufferToBase64 === "function") {
    audioBase64 = wx.arrayBufferToBase64(wav);
  } else {
    // 兼容缺少 ArrayBuffer Base64 API 的旧版微信，仅在这种情况下落临时文件。
    filePath = `${wx.env.USER_DATA_PATH}/yuntuan-voice-${current.id}-${Date.now()}.wav`;
    await writeFile(filePath, wav);
  }
  sendControl(createSessionControl(CONTROL_COMPLETE, current.id)).catch(error => {
    // 音频已经完整重建，不能因为释放设备缓存的确认写失败而丢掉用户这句话。
    console.warn("确认挂件录音完成失败，设备会在超时后自行释放缓存：", error);
  });

  const completedAt = Date.now();
  const completed = {
    sessionId: current.id,
    filePath,
    audioBase64,
    voiceFormat: "wav",
    durationMs: Math.round(sampleCount * 1000 / current.sampleRate),
    realtimeTranscriptPromise,
    timing: {
      recordingStartedAt: current.recordingStartedAt,
      recordingFinishedAt,
      transferStartedAt: current.transferStartedAt,
      completedAt,
      recordingMs: Math.round(sampleCount * 1000 / current.sampleRate),
      transferMs: Math.max(0, completedAt - recordingFinishedAt),
      overlappedTransferMs: Math.max(0, recordingFinishedAt - current.transferStartedAt),
      mtu: state.mtu,
      chunkPayload: current.chunkPayload,
      totalChunks,
      encodedBytes
    }
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
  if (!session || session.id !== sessionId) return;
  const now = Date.now();
  if (session.lastAckRequested === nextSequence &&
      now - session.lastAckRequestedAt < ACK_REPEAT_SUPPRESS_MS) {
    return;
  }
  session.lastAckRequested = nextSequence;
  session.lastAckRequestedAt = now;
  if (!pendingAck || pendingAck.sessionId !== sessionId ||
      nextSequence >= pendingAck.nextSequence) {
    pendingAck = { sessionId, nextSequence };
  }
  drainAckQueue();
}

async function drainAckQueue() {
  if (ackPumpRunning) return;
  ackPumpRunning = true;
  try {
    while (pendingAck) {
      const ack = pendingAck;
      pendingAck = null;
      if (!session || session.id !== ack.sessionId) continue;
      const packet = new Uint8Array(5);
      packet[0] = CONTROL_ACK;
      writeUint16(packet, 1, ack.sessionId);
      writeUint16(packet, 3, ack.nextSequence);
      try {
        await sendControl(packet);
      } catch (error) {
        if (session && session.id === ack.sessionId) failSession(error);
        break;
      }
    }
  } finally {
    ackPumpRunning = false;
    if (pendingAck) drainAckQueue();
  }
}

function createSessionControl(command, sessionId) {
  const packet = new Uint8Array(3);
  packet[0] = command;
  writeUint16(packet, 1, sessionId);
  return packet;
}

function sendControl(packet) {
  controlQueue = controlQueue.catch(() => {}).then(() => withTimeout(
    bleService.writeBuffer(
      config.UUIDS.audioService,
      config.UUIDS.audioControl,
      packet,
      "write"
    ),
    AUDIO_CONTROL_WRITE_TIMEOUT_MS,
    "挂件语音确认写入超时"
  ));
  return controlQueue;
}

function failSession(error) {
  clearAudioTimers();
  const message = error && error.message ? error.message : "挂件录音传输失败";
  const activeSession = session;
  const sessionId = activeSession && activeSession.id
    ? activeSession.id
    : ((state.phase === "recording" || state.phase === "receiving") ? state.sessionId : 0);
  if (activeSession && activeSession.id) realtimeAsr.cancel(activeSession.id, message);
  pendingAck = null;
  session = null;
  finishing = false;
  if (sessionId && bleService.getState().connected) {
    sendControl(createSessionControl(CONTROL_ABORT, sessionId)).catch(() => {});
  }
  setState({ phase: "error", progress: 0, statusText: "挂件录音处理失败", errorMessage: message });
}

function clearAudioActivityTimer() {
  if (!audioActivityTimer) return;
  clearTimeout(audioActivityTimer);
  audioActivityTimer = null;
}

function clearAudioSessionTimer() {
  if (!audioSessionTimer) return;
  clearTimeout(audioSessionTimer);
  audioSessionTimer = null;
}

function clearAudioTimers() {
  clearAudioActivityTimer();
  clearAudioSessionTimer();
}

function startAudioSessionTimer() {
  clearAudioSessionTimer();
  audioSessionTimer = setTimeout(() => {
    audioSessionTimer = null;
    if (state.phase !== "recording" && state.phase !== "receiving") return;
    failSession(new Error("挂件语音会话超过 30 秒未完成，已自动重置"));
  }, AUDIO_SESSION_TIMEOUT_MS);
}

function touchAudioActivity() {
  clearAudioActivityTimer();
  audioActivityTimer = setTimeout(() => {
    audioActivityTimer = null;
    if (state.phase !== "recording" && state.phase !== "receiving") return;
    failSession(new Error("挂件语音传输超过 6 秒没有新数据，已自动重置"));
  }, AUDIO_INACTIVITY_TIMEOUT_MS);
}

function markReady() {
  if (!state.attached || (state.phase !== "complete" && state.phase !== "error")) return;
  clearAudioTimers();
  setState({
    phase: "idle",
    progress: 0,
    statusText: "挂件语音已就绪，短按 PTT 键后说话",
    errorMessage: ""
  });
}

module.exports = {
  attach,
  getState,
  subscribe,
  subscribeCompleted,
  removeFile,
  markReady
};

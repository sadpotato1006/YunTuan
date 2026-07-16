const chatService = require("./chat");

const PCM_FRAME_BYTES = 6400; // 200 ms, 16 kHz, mono, PCM16
const SEND_INTERVAL_MS = 190;
const CONNECT_TIMEOUT_MS = 6000;
const FINAL_TIMEOUT_MS = 10000;
const START_TIMEOUT_MS = 8000;
const SOCKET_SEND_TIMEOUT_MS = 3000;

let activeSession = null;

function start(sessionId) {
  if (!sessionId) throw new Error("实时语音识别会话号无效");
  if (activeSession) cancel(activeSession.id, "新的录音已经开始");

  const context = {
    id: sessionId,
    socket: null,
    ready: false,
    ending: false,
    endSent: false,
    sending: false,
    settled: false,
    chunks: [],
    chunkOffset: 0,
    queuedBytes: 0,
    nextSendAt: 0,
    stableResults: {},
    latestResults: {},
    timers: []
  };
  context.result = new Promise((resolve, reject) => {
    context.resolve = resolve;
    context.reject = reject;
  });
  // The recording may be rejected by hardware VAD before a page awaits this
  // promise. Keep that expected cancellation from becoming an unhandled one.
  context.result.catch(() => {});
  activeSession = context;
  context.timers.push(setTimeout(() => {
    if (!context.ready) fail(context, new Error("启动实时语音识别超时"));
  }, START_TIMEOUT_MS));

  chatService.getRealtimeAsrTicket()
    .then(response => connect(context, response && response.data && response.data.url))
    .catch(error => fail(context, error));
  return context.result;
}

function pushPcm(sessionId, samples) {
  const context = activeSession;
  if (!context || context.id !== sessionId || context.settled || context.ending) return false;
  if (!(samples instanceof Int16Array) || !samples.length) return true;
  const bytes = pcm16ToLittleEndian(samples);
  context.chunks.push(bytes);
  context.queuedBytes += bytes.length;
  drain(context);
  return true;
}

function finish(sessionId) {
  const context = activeSession;
  if (!context || context.id !== sessionId) {
    return Promise.reject(new Error("实时语音识别会话不存在"));
  }
  context.ending = true;
  drain(context);
  return context.result;
}

function cancel(sessionId, reason) {
  const context = activeSession;
  if (!context || (sessionId && context.id !== sessionId)) return;
  fail(context, new Error(reason || "实时语音识别已取消"));
}

function connect(context, url) {
  if (!url || context.settled || activeSession !== context) {
    fail(context, new Error("没有取得实时语音识别连接地址"));
    return;
  }
  if (typeof wx === "undefined" || typeof wx.connectSocket !== "function") {
    fail(context, new Error("当前微信版本不支持实时语音识别连接"));
    return;
  }

  let socket;
  try {
    socket = wx.connectSocket({ url, tcpNoDelay: true });
  } catch (error) {
    fail(context, error);
    return;
  }
  context.socket = socket;
  context.timers.push(setTimeout(() => {
    if (!context.ready) fail(context, new Error("连接实时语音识别服务超时"));
  }, CONNECT_TIMEOUT_MS));

  socket.onMessage(event => handleMessage(context, event && event.data));
  socket.onError(error => fail(context, new Error(error && error.errMsg || "实时语音识别连接失败")));
  socket.onClose(() => {
    if (!context.settled) fail(context, new Error("实时语音识别连接提前关闭"));
  });
}

function handleMessage(context, value) {
  if (context.settled) return;
  let message;
  try {
    message = typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    fail(context, new Error("实时语音识别返回格式错误"));
    return;
  }
  if (!message || Number(message.code) !== 0) {
    fail(context, new Error(message && message.message || "实时语音识别服务返回错误"));
    return;
  }

  if (!context.ready) {
    context.ready = true;
    context.nextSendAt = Date.now();
    drain(context);
  }

  if (message.result) {
    const index = Number(message.result.index);
    const text = typeof message.result.voice_text_str === "string"
      ? message.result.voice_text_str.trim()
      : "";
    if (Number.isInteger(index)) {
      context.latestResults[index] = text;
      if (Number(message.result.slice_type) === 2) context.stableResults[index] = text;
    }
  }

  if (Number(message.final) === 1) {
    const text = collectTranscript(context);
    if (!text) {
      fail(context, new Error("没有听清，请再说一次"));
      return;
    }
    settle(context, null, text);
  }
}

function drain(context) {
  if (context.settled || !context.ready || context.sending) return;
  const frameLength = context.queuedBytes >= PCM_FRAME_BYTES
    ? PCM_FRAME_BYTES
    : (context.ending ? context.queuedBytes : 0);
  if (!frameLength) {
    if (context.ending && !context.endSent) sendEnd(context);
    return;
  }

  const delay = Math.max(0, context.nextSendAt - Date.now());
  context.sending = true;
  context.timers.push(setTimeout(() => {
    if (context.settled) {
      context.sending = false;
      return;
    }
    let frame;
    try {
      frame = takeBytes(context, frameLength);
    } catch (error) {
      fail(context, error);
      return;
    }
    sendSocketData(context, frame.buffer, "上传实时语音数据超时", () => {
      if (!context.settled) {
        context.sending = false;
        context.nextSendAt = Date.now() + SEND_INTERVAL_MS;
        drain(context);
      }
    }, "上传实时语音数据失败");
  }, delay));
}

function sendEnd(context) {
  context.endSent = true;
  sendSocketData(context, JSON.stringify({ type: "end" }), "结束实时语音识别超时", () => {
    context.timers.push(setTimeout(() => {
      if (!context.settled) fail(context, new Error("等待实时语音识别结果超时"));
    }, FINAL_TIMEOUT_MS));
  }, "结束实时语音识别失败");
}

function sendSocketData(context, data, timeoutMessage, onSuccess, failureMessage) {
  if (!context.socket || typeof context.socket.send !== "function") {
    fail(context, new Error("实时语音识别连接不可用"));
    return;
  }
  let completed = false;
  const timer = setTimeout(() => {
    if (completed || context.settled) return;
    completed = true;
    fail(context, new Error(timeoutMessage));
  }, SOCKET_SEND_TIMEOUT_MS);
  context.timers.push(timer);
  try {
    context.socket.send({
      data,
      success() {
        if (completed || context.settled) return;
        completed = true;
        clearTimeout(timer);
        onSuccess();
      },
      fail(error) {
        if (completed || context.settled) return;
        completed = true;
        clearTimeout(timer);
        fail(context, new Error(error && error.errMsg || failureMessage));
      }
    });
  } catch (error) {
    if (completed || context.settled) return;
    completed = true;
    clearTimeout(timer);
    fail(context, error);
  }
}

function takeBytes(context, length) {
  const output = new Uint8Array(length);
  let written = 0;
  while (written < length && context.chunks.length) {
    const first = context.chunks[0];
    const available = first.length - context.chunkOffset;
    const count = Math.min(available, length - written);
    output.set(first.subarray(context.chunkOffset, context.chunkOffset + count), written);
    written += count;
    context.chunkOffset += count;
    context.queuedBytes -= count;
    if (context.chunkOffset >= first.length) {
      context.chunks.shift();
      context.chunkOffset = 0;
    }
  }
  if (written !== length) throw new Error("实时语音缓冲区长度不一致");
  return output;
}

function pcm16ToLittleEndian(samples) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(index * 2, samples[index], true);
  }
  return new Uint8Array(buffer);
}

function collectTranscript(context) {
  const indexes = Object.keys(context.latestResults)
    .map(Number)
    .filter(Number.isInteger)
    .sort((first, second) => first - second);
  return indexes.map(index => {
    return Object.prototype.hasOwnProperty.call(context.stableResults, index)
      ? context.stableResults[index]
      : context.latestResults[index];
  }).join("").trim();
}

function fail(context, error) {
  settle(context, error instanceof Error ? error : new Error(String(error || "实时语音识别失败")));
}

function settle(context, error, text) {
  if (!context || context.settled) return;
  context.settled = true;
  context.timers.forEach(clearTimeout);
  context.timers = [];
  if (context.socket && typeof context.socket.close === "function") {
    try { context.socket.close({ code: 1000 }); } catch (closeError) {}
  }
  if (activeSession === context) activeSession = null;
  if (error) context.reject(error);
  else context.resolve(text);
}

module.exports = { start, pushPcm, finish, cancel };

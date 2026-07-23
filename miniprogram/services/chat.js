const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/chat");
const { SseParser } = require("../utils/sse");

const CHAT_HISTORY_KEY = "yuntuan_chat_history";
const MAX_LOCAL_MESSAGES = 50;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARACTERS = 4000;
const MAX_MESSAGE_CHARACTERS = 500;
const MAX_SPEECH_CHARACTERS = 150;
const SPEECH_SEGMENT_CHARACTERS = 40;
const SPEECH_PROTECTION_RETRY_DELAYS_MS = [150, 400];
const SAVE_DEBOUNCE_MS = 600;
let pendingMessages = null;
let saveTimer = null;
const messageListeners = new Set();

// service 统一选择后端，页面不需要感知 mock、云函数或自建服务器。
function getMessages() {
  const localMessages = getLocalMessages();
  if (localMessages.length) {
    return Promise.resolve({ code: 0, message: "success", data: { messages: localMessages } });
  }

  const mode = config.getBackendMode("chat");
  if (mode === "mock" || mode === "cloud") {
    // 已部署的 chat 云函数只处理真实 AI 消息；欢迎语继续由本地 service 初始化。
    return mock.getMessages();
  }
  if (mode === "http") return request({ url: "/chat/messages" });
  return Promise.reject(new Error(`未知的聊天后端模式：${mode}`));
}

function sendMessage(message, history, requestId) {
  const content = typeof message === "string" ? message.trim() : "";
  if (!content) return Promise.reject(new Error("消息不能为空"));
  if (Array.from(content).length > MAX_MESSAGE_CHARACTERS) {
    return Promise.reject(new Error(`每条消息不能超过 ${MAX_MESSAGE_CHARACTERS} 个字符`));
  }

  const context = buildContext(history);

  const mode = config.getBackendMode("chat");
  if (mode === "mock") return mock.sendMessage(content);
  if (mode === "cloud") {
    // 真实 AI 请求仅由 chat 云函数完成，前端绝不能保存 DeepSeek API Key。
    return callCloudFunction("chat", {
      message: content,
      history: context,
      requestId: normalizeRequestId(requestId)
    });
  }
  if (mode === "http") {
    return request({
      url: "/chat",
      method: "POST",
      data: { message: content, history: context, requestId: normalizeRequestId(requestId) }
    });
  }
  return Promise.reject(new Error(`未知的聊天后端模式：${mode}`));
}

function canStreamMessage() {
  if (config.getBackendMode("chat") !== "cloud" || config.streamChatEnabled === false) return false;
  return typeof wx !== "undefined" && wx.cloud &&
    typeof wx.cloud.callHTTPFunction === "function";
}

function streamMessage(message, history, handlers, requestId) {
  const content = typeof message === "string" ? message.trim() : "";
  if (!content) return Promise.reject(new Error("消息不能为空"));
  if (Array.from(content).length > MAX_MESSAGE_CHARACTERS) {
    return Promise.reject(new Error(`每条消息不能超过 ${MAX_MESSAGE_CHARACTERS} 个字符`));
  }
  if (!canStreamMessage()) {
    return Promise.reject(createStreamError("当前环境不支持流式聊天", true, ""));
  }
  const callbacks = handlers || {};
  const context = buildContext(history);
  let requestTask = null;
  let abortRequest = null;
  const operation = new Promise((resolve, reject) => {
    let settled = false;
    let partialReply = "";
    let receivedDone = false;

    const finishWithError = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    abortRequest = () => {
      if (settled) return;
      const error = createStreamError("已停止生成", false, partialReply);
      error.cancelled = true;
      finishWithError(error);
      if (requestTask && typeof requestTask.abort === "function") {
        try { requestTask.abort(); } catch (ignore) {}
      }
    };
    const parser = new SseParser(event => {
      if (settled) return;
      let payload;
      try {
        payload = event.data ? JSON.parse(event.data) : {};
      } catch (error) {
        finishWithError(createStreamError("流式聊天返回的数据格式不正确", !partialReply, partialReply));
        return;
      }

      try {
        if (event.event === "start") {
          if (typeof callbacks.onStart === "function") callbacks.onStart(payload);
          return;
        }
        if (event.event === "segment") {
          const segment = payload && typeof payload.content === "string" ? payload.content : "";
          if (!segment) return;
          partialReply += segment;
          if (typeof callbacks.onSegment === "function") {
            callbacks.onSegment(segment, payload.index);
          }
          return;
        }
        if (event.event === "error") {
          const canFallback = Boolean(payload && payload.fallbackAllowed) && !partialReply;
          finishWithError(createStreamError(
            payload && payload.message || "流式聊天暂时不可用",
            canFallback,
            partialReply
          ));
          return;
        }
        if (event.event === "done") {
          const reply = payload && typeof payload.reply === "string"
            ? payload.reply.trim()
            : partialReply.trim();
          if (!reply) {
            finishWithError(createStreamError("AI 没有返回有效回复", !partialReply, partialReply));
            return;
          }
          receivedDone = true;
          settled = true;
          resolve({
            code: 0,
            message: "success",
            data: {
              reply,
              streamed: true
            }
          });
        }
      } catch (error) {
        finishWithError(createStreamError(
          error.message || "处理流式回复失败",
          false,
          partialReply
        ));
      }
    });

    try {
      const requestOptions = {
        name: config.streamChatFunctionName || "chat-stream",
        path: config.streamChatPath || "/chat",
        method: "post",
        data: {
          message: content,
          history: context,
          requestId: normalizeRequestId(requestId)
        },
        header: { "content-type": "application/json" },
        enableChunked: true,
        onChunkedReceived(response) {
          if (settled || !response || !response.data) return;
          try {
            parser.push(response.data);
          } catch (error) {
            finishWithError(createStreamError(
              "流式聊天数据解析失败",
              !partialReply,
              partialReply
            ));
          }
        },
        success() {
          if (settled || receivedDone) return;
          try {
            parser.finish();
          } catch (error) {
            finishWithError(createStreamError("流式聊天数据解析失败", !partialReply, partialReply));
            return;
          }
          if (!settled) {
            finishWithError(createStreamError("流式聊天连接提前结束", !partialReply, partialReply));
          }
        },
        fail(error) {
          console.warn("调用流式聊天云函数失败，将按条件降级：", error && error.errMsg);
          const friendly = callCloudFunction.getFriendlyCloudError(error);
          finishWithError(createStreamError(
            friendly,
            !partialReply && isStreamFunctionUnavailable(error),
            partialReply
          ));
        }
      };
      if (config.cloudEnvId) requestOptions.config = { env: config.cloudEnvId };
      requestTask = wx.cloud.callHTTPFunction(requestOptions);
    } catch (error) {
      finishWithError(createStreamError(
        error.message || "无法启动流式聊天",
        !partialReply,
        partialReply
      ));
    }
  });
  operation.abort = () => {
    if (abortRequest) abortRequest();
  };
  return operation;
}

function createStreamError(message, canFallback, partialReply) {
  const error = new Error(message);
  error.canFallback = Boolean(canFallback);
  error.partialReply = partialReply || "";
  return error;
}

function isStreamFunctionUnavailable(error) {
  const message = String(error && (error.errMsg || error.message) || "");
  return /FUNCTION_NOT_FOUND|-501000|not\s+support|unsupported|enableChunked/i.test(message);
}

function buildContext(history) {
  if (!Array.isArray(history)) return [];
  const selected = [];
  let characterCount = 0;

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (!item || (item.role !== "user" && item.role !== "assistant")) continue;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) continue;
    const normalized = Array.from(content).slice(0, 800).join("");
    const length = Array.from(normalized).length;
    if (characterCount + length > MAX_CONTEXT_CHARACTERS) break;
    selected.unshift({ role: item.role, content: normalized });
    characterCount += length;
    if (selected.length >= MAX_CONTEXT_MESSAGES) break;
  }
  return selected;
}

function createRequestId() {
  const randomPart = Math.random().toString(36).slice(2, 14);
  return `chat_${Date.now().toString(36)}_${randomPart}`;
}

function normalizeRequestId(value) {
  const requestId = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_-]{12,80}$/.test(requestId) ? requestId : createRequestId();
}

function transcribeAudio(audioFilePath, voiceFormat, inlineAudioBase64) {
  if (!audioFilePath && !inlineAudioBase64) return Promise.reject(new Error("没有可识别的录音"));

  const format = voiceFormat || "mp3";
  if (format !== "mp3" && format !== "wav") {
    return Promise.reject(new Error("暂不支持这种录音格式"));
  }

  const mode = config.getBackendMode("chat");
  if (mode !== "cloud") {
    return Promise.reject(new Error("语音识别需要启用云开发模式"));
  }
  if (typeof inlineAudioBase64 === "string" && inlineAudioBase64) {
    return callCloudFunction("chat", {
      action: "transcribe",
      audioBase64: inlineAudioBase64,
      voiceFormat: format
    });
  }
  if (!wx.getFileSystemManager) {
    return Promise.reject(new Error("当前微信版本不支持读取录音"));
  }

  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath: audioFilePath,
      encoding: "base64",
      success: async result => {
        try {
          resolve(await callCloudFunction("chat", {
            action: "transcribe",
            audioBase64: result.data,
            voiceFormat: format
          }));
        } catch (error) {
          reject(error);
        }
      },
      fail: error => {
        console.error("读取录音文件失败：", error);
        reject(new Error("读取录音失败，请重试"));
      }
    });
  });
}

function getRealtimeAsrTicket() {
  if (config.getBackendMode("chat") !== "cloud") {
    return Promise.reject(new Error("实时语音识别需要启用云开发模式"));
  }
  return callCloudFunction("chat", { action: "realtimeAsrTicket" });
}

async function synthesizeSpeech(text) {
  const content = typeof text === "string" ? text.trim() : "";
  if (!content) return Promise.reject(new Error("没有可朗读的文字"));
  const mode = config.getBackendMode("chat");
  if (mode !== "cloud") {
    return Promise.reject(new Error("语音合成需要启用云开发模式"));
  }
  return callSpeechFunctionWithRetry({ action: "synthesize", text: content });
}

async function synthesizeSpeechBatch(texts) {
  const normalized = Array.isArray(texts)
    ? texts.map(item => typeof item === "string" ? item.trim() : "").filter(Boolean)
    : [];
  if (!normalized.length) return Promise.reject(new Error("没有可批量朗读的文字"));
  if (normalized.length > 3) return Promise.reject(new Error("一次最多预生成三段朗读语音"));
  const mode = config.getBackendMode("chat");
  if (mode !== "cloud") return Promise.reject(new Error("语音合成需要启用云开发模式"));
  return callSpeechFunctionWithRetry({ action: "synthesizeBatch", texts: normalized });
}

async function callSpeechFunctionWithRetry(data) {
  let retryIndex = 0;
  while (true) {
    try {
      return await callCloudFunction("chat", data);
    } catch (error) {
      if (!isTransientSpeechProtectionError(error) ||
          retryIndex >= SPEECH_PROTECTION_RETRY_DELAYS_MS.length) {
        throw error;
      }
      const delay = SPEECH_PROTECTION_RETRY_DELAYS_MS[retryIndex];
      retryIndex += 1;
      console.warn(`语音合成保护事务冲突，${delay}ms 后重试（${retryIndex}/${SPEECH_PROTECTION_RETRY_DELAYS_MS.length}）`);
      await wait(delay);
    }
  }
}

function isTransientSpeechProtectionError(error) {
  return String(error && error.message || "").includes("聊天保护服务暂时不可用");
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function splitSpeechText(text) {
  const content = typeof text === "string" ? text.trim() : "";
  let remaining = Array.from(content).slice(0, MAX_SPEECH_CHARACTERS);
  const segments = [];
  while (remaining.length) {
    if (remaining.length <= SPEECH_SEGMENT_CHARACTERS) {
      const last = remaining.join("").trim();
      if (last) segments.push(last);
      break;
    }

    let splitAt = SPEECH_SEGMENT_CHARACTERS;
    const minimumNaturalSplit = Math.floor(SPEECH_SEGMENT_CHARACTERS * 0.55);
    for (let index = SPEECH_SEGMENT_CHARACTERS - 1; index >= minimumNaturalSplit; index -= 1) {
      if (/[。！？!?；;，,]/.test(remaining[index])) {
        splitAt = index + 1;
        break;
      }
    }
    const segment = remaining.slice(0, splitAt).join("").trim();
    if (segment) segments.push(segment);
    remaining = remaining.slice(splitAt);
  }
  return segments;
}

function getLocalMessages() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return [];
  const saved = wx.getStorageSync(CHAT_HISTORY_KEY);
  return Array.isArray(saved) ? saved : [];
}

function saveMessages(messages) {
  if (!Array.isArray(messages)) return;
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  pendingMessages = null;
  // 限制本地记录数量，避免长期使用导致缓存无限增长。
  const savedMessages = messages.slice(-MAX_LOCAL_MESSAGES);
  wx.setStorageSync(CHAT_HISTORY_KEY, savedMessages);
  notifyMessages(savedMessages);
}

function subscribeMessages(listener) {
  if (typeof listener !== "function") throw new Error("聊天记录监听器必须是函数");
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

function notifyMessages(messages) {
  const snapshot = Array.isArray(messages) ? messages.slice() : [];
  messageListeners.forEach(listener => listener(snapshot));
}

function scheduleSaveMessages(messages) {
  if (!Array.isArray(messages)) return;
  pendingMessages = messages.slice(-MAX_LOCAL_MESSAGES);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const next = pendingMessages;
    pendingMessages = null;
    saveTimer = null;
    if (next) saveMessages(next);
  }, SAVE_DEBOUNCE_MS);
}

function flushMessages() {
  if (!pendingMessages) return;
  const next = pendingMessages;
  pendingMessages = null;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saveMessages(next);
}

async function clearMessages() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  pendingMessages = null;
  if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
    wx.removeStorageSync(CHAT_HISTORY_KEY);
  }
  const result = await mock.getMessages();
  notifyMessages(result.data && result.data.messages || []);
  return result;
}

module.exports = {
  getMessages,
  sendMessage,
  canStreamMessage,
  streamMessage,
  transcribeAudio,
  getRealtimeAsrTicket,
  synthesizeSpeech,
  synthesizeSpeechBatch,
  splitSpeechText,
  buildContext,
  createRequestId,
  subscribeMessages,
  saveMessages,
  scheduleSaveMessages,
  flushMessages,
  clearMessages
};

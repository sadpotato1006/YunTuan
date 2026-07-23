const chatService = require("./chat");
const deviceAudioService = require("./yuntuan-audio");
const deviceTtsService = require("./yuntuan-tts");

const MAX_QUEUED_RECORDINGS = 3;
const BUSY_RETRY_MS = 500;

let started = false;
let foreground = false;
let hasEnteredForeground = false;
let processing = false;
let activeRecording = null;
let unsubscribeCompleted = null;
let retryTimer = null;
const queue = [];
const listeners = new Set();
let state = {
  phase: "idle",
  recognizing: false,
  thinking: false,
  speaking: false,
  errorMessage: ""
};

function getState() {
  return Object.assign({}, state, {
    foreground,
    processing,
    queuedCount: queue.length
  });
}

function setState(patch) {
  state = Object.assign({}, state, patch);
  const snapshot = getState();
  listeners.forEach(listener => listener(snapshot));
}

function subscribe(listener) {
  if (typeof listener !== "function") throw new Error("全局挂件聊天监听器必须是函数");
  listeners.add(listener);
  listener(getState());
  return () => listeners.delete(listener);
}

function start() {
  if (started) return;
  started = true;
  unsubscribeCompleted = deviceAudioService.subscribeCompleted(enqueue);
}

function setForeground(value) {
  foreground = Boolean(value);
  if (foreground) hasEnteredForeground = true;
  if (canContinueProcessing()) processQueue();
  setState({});
}

function canContinueProcessing() {
  // 微信可能在切到后台后继续给小程序一段运行时间。只要本次会话确实进入过前台，
  // 就不主动掐断 BLE、识别、AI 和播报链路；被系统暂停后，回到前台会继续队列。
  return foreground || hasEnteredForeground;
}

function enqueue(recording) {
  const hasInlineAudio = recording &&
    typeof recording.audioBase64 === "string" && Boolean(recording.audioBase64);
  if (!recording || (!recording.filePath && !hasInlineAudio)) return;

  while (queue.length >= MAX_QUEUED_RECORDINGS) {
    const discarded = queue.shift();
    deviceAudioService.cancelRecognition(discarded.sessionId, "新的挂件录音已到达");
    deviceAudioService.removeFile(discarded.filePath);
  }
  queue.push(recording);
  setState({ errorMessage: "" });
  processQueue();
}

async function processQueue() {
  if (!started || !canContinueProcessing() || processing || !queue.length) return;

  const historyResult = await chatService.getMessages().catch(error => {
    setState({ phase: "error", errorMessage: error.message || "读取本地对话失败" });
    scheduleRetry();
    return null;
  });
  if (!historyResult || !canContinueProcessing() || processing || !queue.length) return;

  const history = Array.isArray(historyResult.data && historyResult.data.messages)
    ? historyResult.data.messages
    : [];
  if (history.some(message => message && message.status === "sending")) {
    scheduleRetry();
    return;
  }

  const recording = queue.shift();
  processing = true;
  activeRecording = recording;
  setState({
    phase: "recognizing",
    recognizing: true,
    thinking: false,
    speaking: false,
    errorMessage: ""
  });

  let userMessageId = "";
  try {
    const content = await transcribe(recording);
    if (!content) throw new Error("没有听清，请再说一次");

    const requestId = chatService.createRequestId();
    userMessageId = `hardware-user-${Date.now()}`;
    const userMessages = history.concat({
      id: userMessageId,
      role: "user",
      content,
      status: "sending",
      requestId,
      source: "hardware"
    });
    chatService.saveMessages(userMessages);
    setState({ phase: "thinking", recognizing: false, thinking: true });

    const result = await chatService.sendMessage(content, history, requestId);
    const replyText = result && result.data && typeof result.data.reply === "string"
      ? result.data.reply.trim()
      : "";
    if (!replyText) throw new Error("AI 没有返回有效回复");

    const latestResult = await chatService.getMessages();
    const latestMessages = Array.isArray(latestResult.data && latestResult.data.messages)
      ? latestResult.data.messages
      : userMessages;
    const sentMessages = latestMessages.map(message => message && message.id === userMessageId
      ? Object.assign({}, message, { status: "sent", errorMessage: "" })
      : message);
    sentMessages.push({
      id: `hardware-ai-${Date.now()}`,
      role: "assistant",
      content: replyText,
      replyTo: userMessageId,
      status: "done",
      source: "hardware"
    });
    chatService.saveMessages(sentMessages);
    setState({ phase: "speaking", thinking: false, speaking: true });

    if (canContinueProcessing() && deviceTtsService.getState().attached) {
      await playReply(replyText);
    }
    setState({ phase: "idle", speaking: false, errorMessage: "" });
  } catch (error) {
    markMessageFailed(userMessageId, error);
    setState({
      phase: "error",
      recognizing: false,
      thinking: false,
      speaking: false,
      errorMessage: error && error.message || "挂件语音对话失败"
    });
    if (foreground && typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({
        title: error && error.message || "挂件语音对话失败，请重试",
        icon: "none",
        duration: 2800
      });
    }
  } finally {
    deviceAudioService.removeFile(recording.filePath);
    deviceAudioService.markReady();
    activeRecording = null;
    processing = false;
    if (state.phase !== "error") setState({ phase: "idle", recognizing: false, thinking: false, speaking: false });
    processQueue();
  }
}

async function transcribe(recording) {
  if (recording.realtimeTranscriptPromise) {
    try {
      const realtimeText = await recording.realtimeTranscriptPromise;
      if (typeof realtimeText === "string" && realtimeText.trim()) return realtimeText.trim();
    } catch (error) {
      console.warn("实时语音识别失败，改用完整录音识别：", error && error.message);
    }
  }
  const response = await chatService.transcribeAudio(
    recording.filePath,
    recording.voiceFormat || "wav",
    recording.audioBase64
  );
  return response && response.data && typeof response.data.text === "string"
    ? response.data.text.trim()
    : "";
}

async function playReply(text) {
  const segments = chatService.splitSpeechText(text);
  if (!segments.length) return;

  const first = await chatService.synthesizeSpeech(segments[0]);
  await deviceTtsService.play(first.data);
  if (!canContinueProcessing() || segments.length === 1) return;

  const remaining = await chatService.synthesizeSpeechBatch(segments.slice(1));
  const audioSegments = remaining && remaining.data && remaining.data.segments;
  if (!Array.isArray(audioSegments) || audioSegments.length !== segments.length - 1) {
    throw new Error("后续语音生成结果不完整");
  }
  for (let index = 0; index < audioSegments.length && canContinueProcessing(); index += 1) {
    await deviceTtsService.play(audioSegments[index]);
  }
}

function markMessageFailed(messageId, error) {
  if (!messageId) return;
  chatService.getMessages().then(result => {
    const messages = Array.isArray(result.data && result.data.messages) ? result.data.messages : [];
    chatService.saveMessages(messages.map(message => message && message.id === messageId
      ? Object.assign({}, message, {
        status: "failed",
        errorMessage: error && error.message || "挂件语音对话失败"
      })
      : message));
  }).catch(() => {});
}

function scheduleRetry() {
  if (!canContinueProcessing() || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    processQueue();
  }, BUSY_RETRY_MS);
}

function clearRetryTimer() {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function stop() {
  clearRetryTimer();
  if (unsubscribeCompleted) unsubscribeCompleted();
  unsubscribeCompleted = null;
  started = false;
  foreground = false;
  hasEnteredForeground = false;
  if (activeRecording) {
    deviceAudioService.cancelRecognition(activeRecording.sessionId, "全局挂件聊天已停止");
  }
}

module.exports = { start, stop, setForeground, getState, subscribe, enqueue };

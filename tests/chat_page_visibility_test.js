const assert = require("assert");
const Module = require("module");

let pageDefinition = null;
let recognitionCancels = 0;
let playbackCancels = 0;
let removedFiles = 0;
let readyMarks = 0;

const chatServiceStub = {
  createRequestId() { return "request-1"; }
};
const audioServiceStub = {
  cancelRecognition() { recognitionCancels += 1; },
  removeFile() { removedFiles += 1; },
  markReady() { readyMarks += 1; }
};
const ttsServiceStub = {
  cancel() { playbackCancels += 1; return Promise.resolve(true); }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (parent && /pages[\\/]chat[\\/]chat\.js$/.test(parent.filename)) {
    if (request === "../../services/chat") return chatServiceStub;
    if (request === "../../services/yuntuan-audio") return audioServiceStub;
    if (request === "../../services/yuntuan-tts") return ttsServiceStub;
    if (request === "../../services/diagnostics") return { record() {} };
    if (request === "./voice-latency") return { buildVoiceLatencyMetrics() { return {}; } };
    if (request === "./stream-reply-renderer") return { createStreamReplyRenderer() { return {}; } };
    if (request === "./streaming-speech-queue") return { createStreamingSpeechQueue() { return null; } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

global.Page = definition => { pageDefinition = definition; };
global.wx = { showToast() {} };
require("../miniprogram/pages/chat/chat");
Module._load = originalLoad;

function createPage() {
  const page = Object.assign({}, pageDefinition);
  page.data = Object.assign({}, pageDefinition.data, { loading: false });
  page._hardwareVoiceQueue = [];
  page._pageActive = false;
  page.setData = function setData(patch) {
    this.data = Object.assign({}, this.data, patch);
  };
  return page;
}

function waitForTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

(async () => {
  const page = createPage();
  let sentMessages = 0;
  page.sendMessage = async () => { sentMessages += 1; };
  page.enqueueHardwareRecording({
    sessionId: 1,
    filePath: "hidden.wav",
    realtimeTranscriptPromise: Promise.resolve("返回页面后处理")
  });

  assert.strictEqual(recognitionCancels, 1, "页面隐藏时应停止实时识别");
  assert.strictEqual(page._hardwareVoiceQueue.length, 1, "隐藏期间的完整录音应留在队列中");
  assert.strictEqual(sentMessages, 0, "页面隐藏时不应请求 AI");

  page.onShow();
  await waitForTurn();
  await waitForTurn();
  assert.strictEqual(sentMessages, 1, "返回聊天页后应恢复处理队列");
  assert.strictEqual(removedFiles, 1);
  assert.strictEqual(readyMarks, 1);

  let resolveTranscript;
  const inFlightTranscript = new Promise(resolve => { resolveTranscript = resolve; });
  page._pageActive = true;
  page._hardwareVoiceQueue.push({
    sessionId: 2,
    filePath: "in-flight.wav",
    realtimeTranscriptPromise: inFlightTranscript
  });
  const processing = page.processHardwareVoiceQueue();
  await waitForTurn();
  page.onHide();
  resolveTranscript("隐藏后不应发送");
  await processing;

  assert.strictEqual(sentMessages, 1, "隐藏页面后，正在识别的录音不得继续请求 AI");
  assert.strictEqual(recognitionCancels, 2);
  assert.strictEqual(playbackCancels, 1, "隐藏页面后应停止挂件朗读");

  let aborted = 0;
  page._processingHardwareVoice = true;
  page._activeHardwareRecording = { sessionId: 3 };
  page.data.generating = true;
  page._activeChatRequest = { abort() { aborted += 1; } };
  page.onHide();
  assert.strictEqual(aborted, 1, "隐藏页面后应中止挂件触发的流式 AI 请求");
  assert.strictEqual(page._generationCancelled, true);

  console.log("chat page visibility tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require("assert");
const Module = require("module");

let completedListener = null;
let messages = [{ id: "welcome", role: "assistant", content: "你好", status: "done" }];
let sendCount = 0;
let playCount = 0;
let removedCount = 0;
let readyCount = 0;

const chatServiceStub = {
  getMessages() {
    return Promise.resolve({ data: { messages: messages.slice() } });
  },
  createRequestId() { return "request-global-voice"; },
  saveMessages(next) { messages = next.slice(); },
  sendMessage(content) {
    sendCount += 1;
    assert.strictEqual(content, "今天天气怎么样");
    return Promise.resolve({ data: { reply: "今天天气很好。" } });
  },
  transcribeAudio() { throw new Error("实时识别成功时不应回退整句识别"); },
  splitSpeechText() { return ["今天天气很好。"]; },
  synthesizeSpeech() {
    return Promise.resolve({ data: { codec: "ima-adpcm" } });
  },
  synthesizeSpeechBatch() { return Promise.resolve({ data: { segments: [] } }); }
};
const audioServiceStub = {
  subscribeCompleted(listener) {
    completedListener = listener;
    return () => { completedListener = null; };
  },
  cancelRecognition() {},
  removeFile() { removedCount += 1; },
  markReady() { readyCount += 1; }
};
const ttsServiceStub = {
  getState() { return { attached: true }; },
  play(payload) {
    playCount += 1;
    assert.strictEqual(payload.codec, "ima-adpcm");
    return Promise.resolve();
  }
};

const originalLoad = Module._load;
const originalWx = global.wx;
Module._load = function load(request, parent, isMain) {
  if (parent && /services[\\/]hardware-ai-chat\.js$/.test(parent.filename)) {
    if (request === "./chat") return chatServiceStub;
    if (request === "./yuntuan-audio") return audioServiceStub;
    if (request === "./yuntuan-tts") return ttsServiceStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
global.wx = { showToast() {} };

const service = require("../miniprogram/services/hardware-ai-chat");
Module._load = originalLoad;

function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error("等待全局挂件对话完成超时"));
      setTimeout(check, 5);
    };
    check();
  });
}

(async () => {
  service.start();
  assert.strictEqual(typeof completedListener, "function");

  service.setForeground(true);
  service.setForeground(false);
  completedListener({
    sessionId: 7,
    filePath: "global.wav",
    realtimeTranscriptPromise: Promise.resolve("今天天气怎么样")
  });
  await waitFor(() => !service.getState().processing && sendCount === 1, 1000);

  assert.strictEqual(service.getState().foreground, false, "测试应覆盖小程序隐藏后的处理链路");
  assert.strictEqual(sendCount, 1, "小程序隐藏后只要运行环境尚未冻结，仍应处理挂件录音");
  assert.strictEqual(playCount, 1, "AI 回复应通过挂件扬声器播放");
  assert.strictEqual(removedCount, 1, "处理完成后应清理临时录音");
  assert.strictEqual(readyCount, 1, "处理完成后应恢复挂件录音就绪状态");
  assert.ok(messages.some(item => item.role === "user" && item.status === "sent"));
  assert.ok(messages.some(item => item.role === "assistant" && item.content === "今天天气很好。"));

  service.stop();
  global.wx = originalWx;
  console.log("hardware AI chat tests passed");
})().catch(error => {
  Module._load = originalLoad;
  global.wx = originalWx;
  console.error(error);
  process.exitCode = 1;
});

const assert = require("assert");
const Module = require("module");

let pageDefinition = null;
let activeSyntheses = 0;
let maximumActiveSyntheses = 0;
const synthesisOrder = [];
const playbackOrder = [];
const expectedError = new Error("第二段语音合成失败");

const chatServiceStub = {
  async synthesizeSpeech(text) {
    synthesisOrder.push(text);
    activeSyntheses += 1;
    maximumActiveSyntheses = Math.max(maximumActiveSyntheses, activeSyntheses);
    await new Promise(resolve => setTimeout(resolve, 5));
    activeSyntheses -= 1;
    if (text === "第二段。") throw expectedError;
    return { data: { text } };
  }
};

const ttsServiceStub = {
  async play(payload) {
    playbackOrder.push(payload.text);
  }
};

const originalLoad = Module._load;
const originalPage = global.Page;
const originalWarn = console.warn;

Module._load = function load(request, parent, isMain) {
  if (parent && /miniprogram[\\/]pages[\\/]chat[\\/]chat\.js$/.test(parent.filename)) {
    if (request === "../../services/chat") return chatServiceStub;
    if (request === "../../services/yuntuan-audio") return {};
    if (request === "../../services/yuntuan-tts") return ttsServiceStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
global.Page = definition => { pageDefinition = definition; };
console.warn = () => {};

try {
  require("../miniprogram/pages/chat/chat");
} finally {
  Module._load = originalLoad;
  global.Page = originalPage;
}

(async () => {
  assert.ok(pageDefinition && typeof pageDefinition.createStreamingSpeechQueue === "function");
  const page = Object.assign({
    data: {},
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    }
  }, pageDefinition);

  const queue = page.createStreamingSpeechQueue(null);
  queue.enqueue("第一段。");
  queue.enqueue("第二段。");
  queue.enqueue("第三段。");

  await assert.rejects(queue.finish(), error => error === expectedError);
  assert.strictEqual(maximumActiveSyntheses, 1);
  assert.deepStrictEqual(synthesisOrder, ["第一段。", "第二段。", "第三段。"]);
  assert.deepStrictEqual(playbackOrder, ["第一段。", "第三段。"]);
  console.log("chat speech queue tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  console.warn = originalWarn;
});

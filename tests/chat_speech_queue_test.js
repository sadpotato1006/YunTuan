const assert = require("assert");
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

const originalWarn = console.warn;
console.warn = () => {};
const { createStreamingSpeechQueue } = require("../miniprogram/pages/chat/streaming-speech-queue");

(async () => {
  const page = {
    data: {},
    setData(patch) {
      this.data = Object.assign({}, this.data, patch);
    }
  };

  const queue = createStreamingSpeechQueue(page, chatServiceStub, ttsServiceStub, null);
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

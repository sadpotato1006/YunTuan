const assert = require("assert");

const originalWx = global.wx;
const originalGetApp = global.getApp;
let attempts = 0;

global.getApp = () => ({ globalData: { cloudInitialized: true } });
global.wx = {
  cloud: {
    callFunction(options) {
      attempts += 1;
      if (attempts < 3) {
        options.success({
          result: { code: 503, message: "聊天保护服务暂时不可用，请稍后再试", data: {} }
        });
        return;
      }
      options.success({
        result: { code: 0, message: "success", data: { codec: "ima-adpcm" } }
      });
    }
  }
};

const chatService = require("../miniprogram/services/chat");

(async () => {
  const result = await chatService.synthesizeSpeech("测试重试");
  assert.strictEqual(attempts, 3);
  assert.strictEqual(result.data.codec, "ima-adpcm");

  attempts = 0;
  global.wx.cloud.callFunction = options => {
    attempts += 1;
    options.success({
      result: { code: 429, message: "操作太频繁，请稍等一会儿再试", data: {} }
    });
  };
  await assert.rejects(
    chatService.synthesizeSpeech("不可重试错误"),
    /操作太频繁/
  );
  assert.strictEqual(attempts, 1);
  console.log("chat speech retry tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.wx = originalWx;
  global.getApp = originalGetApp;
});

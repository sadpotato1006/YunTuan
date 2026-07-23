const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pageSource = fs.readFileSync(
  path.join(root, "miniprogram/pages/chat/chat.js"),
  "utf8"
);
const appSource = fs.readFileSync(path.join(root, "miniprogram/app.js"), "utf8");

assert.ok(
  appSource.includes('require("./services/hardware-ai-chat")'),
  "小程序生命周期应加载全局挂件 AI 对话服务"
);
assert.ok(
  appSource.includes("hardwareAiChatService.setForeground(true)"),
  "小程序进入前台时应启用挂件 AI 对话"
);
assert.ok(
  appSource.includes("hardwareAiChatService.setForeground(false)"),
  "小程序退到后台时应更新可见状态，但不应直接销毁全局服务"
);
const hardwareServiceSource = fs.readFileSync(
  path.join(root, "miniprogram/services/hardware-ai-chat.js"),
  "utf8"
);
assert.ok(
  hardwareServiceSource.includes("return foreground || hasEnteredForeground"),
  "小程序进入过前台后，应在微信允许的后台运行窗口内继续挂件 AI 对话"
);
assert.ok(
  pageSource.includes('require("../../services/hardware-ai-chat")'),
  "聊天页应只订阅全局挂件 AI 对话状态"
);
assert.ok(
  !pageSource.includes("deviceAudioService.subscribeCompleted"),
  "聊天页不应再次订阅完整录音，避免同一段语音被处理两次"
);
assert.ok(
  !pageSource.includes("enqueueHardwareRecording"),
  "挂件录音队列不应再依赖聊天页是否打开"
);

console.log("chat page visibility tests passed");

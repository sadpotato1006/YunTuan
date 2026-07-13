const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/chat");

// service 统一选择后端，页面不需要感知 mock、云函数或自建服务器。
function getMessages() {
  if (config.backendMode === "mock") return mock.getMessages();
  if (config.backendMode === "cloud") return callCloudFunction("chat", { action: "getMessages" });
  return request({ url: "/chat/messages" });
}

function sendMessage(message, audioFilePath) {
  if (config.backendMode === "mock") return mock.sendMessage(message);
  if (config.backendMode === "cloud") {
    // 小程序只调用 chat 云函数；AI API Key 不得存放在小程序前端。
    return callCloudFunction("chat", { action: "sendMessage", message, audioFilePath });
  }
  // HTTP 模式下可先用 wx.uploadFile 上传录音，再提交识别文本或文件地址。
  return request({ url: "/chat/messages", method: "POST", data: { message, audioFilePath } });
}

module.exports = { getMessages, sendMessage };

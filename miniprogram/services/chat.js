const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/chat");

const CHAT_HISTORY_KEY = "yuntuan_chat_history";
const MAX_LOCAL_MESSAGES = 50;

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

function sendMessage(message, audioFilePath) {
  const content = typeof message === "string" ? message.trim() : "";
  if (!content) return Promise.reject(new Error("消息不能为空"));

  const mode = config.getBackendMode("chat");
  if (mode === "mock") return mock.sendMessage(content);
  if (mode === "cloud") {
    // 真实 AI 请求仅由 chat 云函数完成，前端绝不能保存 DeepSeek API Key。
    return callCloudFunction("chat", { message: content, audioFilePath });
  }
  if (mode === "http") {
    // HTTP 模式下可先用 wx.uploadFile 上传录音，再提交识别文本或文件地址。
    return request({ url: "/chat", method: "POST", data: { message: content, audioFilePath } });
  }
  return Promise.reject(new Error(`未知的聊天后端模式：${mode}`));
}

function getLocalMessages() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return [];
  const saved = wx.getStorageSync(CHAT_HISTORY_KEY);
  return Array.isArray(saved) ? saved : [];
}

function saveMessages(messages) {
  if (!Array.isArray(messages)) return;
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  // 限制本地记录数量，避免长期使用导致缓存无限增长。
  wx.setStorageSync(CHAT_HISTORY_KEY, messages.slice(-MAX_LOCAL_MESSAGES));
}

async function clearMessages() {
  if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
    wx.removeStorageSync(CHAT_HISTORY_KEY);
  }
  return mock.getMessages();
}

module.exports = { getMessages, sendMessage, saveMessages, clearMessages };

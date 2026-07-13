const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async event => {
  if (event.action === "getMessages") {
    return { code: 0, message: "success", data: { messages: [
      { id: "welcome-cloud", role: "assistant", content: "您好呀，我是云团。今天想和我聊些什么？" }
    ] } };
  }

  const message = event.message || "";
  if (!message.trim()) return { code: 1, message: "消息不能为空", data: {} };

  // 后续在这里由云函数调用 AI 平台。API Key 必须使用环境变量或安全配置，绝不能写入小程序前端或源码。
  return { code: 0, message: "success", data: {
    reply: "我听到了。云团会在这里陪着您，慢慢聊就好。"
  } };
};

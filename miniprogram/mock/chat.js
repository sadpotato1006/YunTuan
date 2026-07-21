const initialMessages = [
  { id: "welcome", role: "assistant", content: "您好呀，我是云团。今天想和我聊些什么？" }
];

function getMessages() {
  return new Promise(resolve => setTimeout(() => resolve({
    code: 0, message: "success", data: { messages: initialMessages }
  }), 350));
}

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // 保留失败分支，便于页面验证异常提示；真实接口也遵循相同返回结构。
      if (!message || !message.trim()) {
        reject(new Error("没有听清，请再说一次"));
        return;
      }
      resolve({ code: 0, message: "success", data: {
        reply: "我听到了。慢慢来，我会一直陪着您。今天有没有什么让您开心的小事？"
      }});
    }, 1400);
  });
}

module.exports = { getMessages, sendMessage };

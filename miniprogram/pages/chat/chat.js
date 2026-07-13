const chatService = require("../../services/chat");
Page({
  data: { messages: [], listening: false, thinking: false, loading: true },
  onLoad() { this.loadMessages(); },
  async loadMessages() {
    try {
      const result = await chatService.getMessages();
      this.setData({ messages: result.data.messages, loading: false });
    } catch (error) { this.handleError(error); }
  },
  async toggleListening() {
    if (this.data.thinking) return;
    if (!this.data.listening) {
      // 当前仅模拟录音；后续可在这里使用 wx.getRecorderManager 开始录音。
      this.setData({ listening: true });
      return;
    }
    const userMessage = { id: `user-${Date.now()}`, role: "user", content: "我想和你聊聊天。" };
    this.setData({ listening: false, thinking: true, messages: this.data.messages.concat(userMessage) });
    this.scrollToBottom();
    try {
      // 页面调用 service；service 内部负责 Mock/真实 AI 接口切换。
      const result = await chatService.sendMessage(userMessage.content);
      const reply = { id: `ai-${Date.now()}`, role: "assistant", content: result.data.reply };
      this.setData({ messages: this.data.messages.concat(reply), thinking: false });
      this.scrollToBottom();
    } catch (error) { this.handleError(error); }
  },
  scrollToBottom() { setTimeout(() => this.setData({ scrollIntoView: "chat-bottom" }), 50); },
  handleError(error) {
    this.setData({ loading: false, listening: false, thinking: false });
    wx.showToast({ title: error.message || "操作失败，请重试", icon: "none", duration: 2200 });
  }
});

const chatService = require("../../services/chat");

Page({
  data: {
    messages: [],
    inputValue: "",
    listening: false,
    thinking: false,
    loading: true
  },

  onLoad() { this.loadMessages(); },

  async loadMessages() {
    try {
      const result = await chatService.getMessages();
      this.setData({ messages: result.data.messages, loading: false });
    } catch (error) {
      this.handleError(error);
    }
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  sendTextMessage() {
    if (this.data.thinking || this.data.loading || this.data.listening) return;

    const content = this.data.inputValue.trim();
    if (!content) {
      wx.showToast({ title: "请输入想说的话", icon: "none" });
      return;
    }
    this.setData({ inputValue: "" });
    this.sendMessage(content);
  },

  toggleListening() {
    // AI 正在回复时忽略再次点击，避免重复提交和消息顺序错乱。
    if (this.data.thinking || this.data.loading) return;

    if (!this.data.listening) {
      // 当前仅模拟录音；后续可在这里使用 wx.getRecorderManager 开始录音。
      this.setData({ listening: true });
      return;
    }

    this.setData({ listening: false });
    // 当前用固定识别结果模拟语音转文字，之后替换为真实识别文本即可。
    this.sendMessage("我想和你聊聊天。");
  },

  async sendMessage(content) {
    if (this.data.thinking) return;

    const userItem = {
      id: `user-${Date.now()}`,
      role: "user",
      content
    };
    const userMessages = this.data.messages.concat(userItem);
    this.setData({
      thinking: true,
      messages: userMessages
    });
    chatService.saveMessages(userMessages);
    this.scrollToBottom();

    try {
      // 页面只调用 service；service 内部负责 Mock、云函数和 HTTP 切换。
      const result = await chatService.sendMessage(content);
      if (!result.data || !result.data.reply) {
        throw new Error("AI 没有返回有效回复");
      }

      const reply = {
        id: `ai-${Date.now()}`,
        role: "assistant",
        content: result.data.reply
      };
      const replyMessages = userMessages.concat(reply);
      this.setData({ messages: replyMessages });
      chatService.saveMessages(replyMessages);
      this.scrollToBottom();
    } catch (error) {
      console.error("发送聊天消息失败：", error);
      wx.showToast({
        title: error.message || "发送失败，请稍后重试",
        icon: "none",
        duration: 2600
      });
    } finally {
      this.setData({ thinking: false, listening: false });
    }
  },

  clearConversation() {
    if (this.data.thinking || this.data.loading) return;

    wx.showModal({
      title: "清空对话",
      content: "确定清空当前聊天记录吗？",
      confirmText: "清空",
      confirmColor: "#C06052",
      success: async result => {
        if (!result.confirm) return;
        try {
          const response = await chatService.clearMessages();
          this.setData({ messages: response.data.messages, inputValue: "" });
          wx.showToast({ title: "已清空", icon: "success" });
        } catch (error) {
          this.handleError(error);
        }
      }
    });
  },

  scrollToBottom() {
    setTimeout(() => this.setData({ scrollIntoView: "chat-bottom" }), 50);
  },

  handleError(error) {
    this.setData({ loading: false, listening: false, thinking: false });
    wx.showToast({
      title: error.message || "操作失败，请重试",
      icon: "none",
      duration: 2200
    });
  }
});

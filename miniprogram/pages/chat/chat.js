const chatService = require("../../services/chat");
const deviceAudioService = require("../../services/yuntuan-audio");
const deviceTtsService = require("../../services/yuntuan-tts");

Page({
  data: {
    messages: [],
    inputValue: "",
    listening: false,
    recognizing: false,
    thinking: false,
    speaking: false,
    loading: true,
    hardwareVoiceSupported: false,
    hardwareVoiceActive: false,
    hardwareVoiceText: "请先在设备页连接云团挂件",
    hardwarePlaybackSupported: false,
    hardwarePlaybackText: "挂件朗读尚未连接"
  },

  onLoad() {
    this._hardwareVoiceQueue = [];
    this._unsubscribeHardwareVoiceState = deviceAudioService.subscribe(state => {
      if (this._pageUnloaded) return;
      const active = state.phase === "recording" || state.phase === "receiving" || state.phase === "decoding";
      const text = state.errorMessage || state.statusText;
      this.setData({
        hardwareVoiceSupported: state.supported,
        hardwareVoiceActive: active,
        hardwareVoiceText: text
      });
    });
    this._unsubscribeHardwareVoiceCompleted = deviceAudioService.subscribeCompleted(recording => {
      this.enqueueHardwareRecording(recording);
    });
    this._unsubscribeHardwarePlayback = deviceTtsService.subscribe(state => {
      if (this._pageUnloaded) return;
      const active = state.phase === "sending" || state.phase === "playing";
      this.setData({
        hardwarePlaybackSupported: state.supported,
        speaking: active || (this.data.speaking && state.phase === "idle"),
        hardwarePlaybackText: state.errorMessage || state.statusText
      });
    });
    this.initVoiceRecorder();
    this.loadMessages();
  },

  onHide() {
    this.stopVoiceRecognition(true);
  },

  onUnload() {
    this._pageUnloaded = true;
    this.stopVoiceRecognition(true);
    this.releaseVoiceRecorder();
    if (this._unsubscribeHardwareVoiceState) this._unsubscribeHardwareVoiceState();
    if (this._unsubscribeHardwareVoiceCompleted) this._unsubscribeHardwareVoiceCompleted();
    if (this._unsubscribeHardwarePlayback) this._unsubscribeHardwarePlayback();
    (this._hardwareVoiceQueue || []).forEach(item => deviceAudioService.removeFile(item.filePath));
    this._hardwareVoiceQueue = [];
  },

  initVoiceRecorder() {
    if (this._recorderManager) return true;

    try {
      const manager = wx.getRecorderManager();

      this._onRecorderStart = () => {
        if (this._pageUnloaded) return;
        this.setData({ listening: true, recognizing: false });
      };

      this._onRecorderStop = result => {
        this.handleRecordedAudio(result);
      };

      this._onRecorderError = error => {
        console.error("录音失败：", error);
        if (this._pageUnloaded) return;
        this.setData({ listening: false, recognizing: false });
        if (this._discardVoiceResult) {
          this._discardVoiceResult = false;
          return;
        }
        wx.showToast({
          title: this.getRecorderErrorMessage(error),
          icon: "none",
          duration: 2600
        });
      };

      manager.onStart(this._onRecorderStart);
      manager.onStop(this._onRecorderStop);
      manager.onError(this._onRecorderError);

      this._recorderManager = manager;
      return true;
    } catch (error) {
      console.error("初始化录音失败：", error);
      return false;
    }
  },

  releaseVoiceRecorder() {
    const manager = this._recorderManager;
    if (!manager) return;
    if (typeof manager.offStart === "function") manager.offStart(this._onRecorderStart);
    if (typeof manager.offStop === "function") manager.offStop(this._onRecorderStop);
    if (typeof manager.offError === "function") manager.offError(this._onRecorderError);
    this._recorderManager = null;
  },

  getRecorderErrorMessage(error) {
    const message = error && (error.msg || error.errMsg);
    if (message && /auth|authorize|permission|deny/i.test(message)) {
      return "请允许使用麦克风后重试";
    }
    return "录音失败，请重试";
  },

  async handleRecordedAudio(result) {
    const shouldDiscard = this._discardVoiceResult || this._pageUnloaded;
    this._discardVoiceResult = false;
    if (this._pageUnloaded) return;

    this.setData({ listening: false });
    if (shouldDiscard) {
      this.setData({ recognizing: false });
      return;
    }

    if (!result || !result.tempFilePath || result.duration < 500) {
      this.setData({ recognizing: false });
      wx.showToast({ title: "说话时间太短，请重试", icon: "none" });
      return;
    }

    this.setData({ recognizing: true });
    try {
      const response = await chatService.transcribeAudio(result.tempFilePath);
      if (this._pageUnloaded || this._discardVoiceResult) return;
      const content = response.data && typeof response.data.text === "string"
        ? response.data.text.trim()
        : "";
      if (!content) throw new Error("没有听清，请再说一次");

      this.setData({ inputValue: "", recognizing: false });
      this.sendMessage(content);
    } catch (error) {
      if (this._pageUnloaded || this._discardVoiceResult) return;
      console.error("语音转文字失败：", error);
      this.setData({ recognizing: false });
      wx.showToast({
        title: error.message || "语音识别失败，请重试",
        icon: "none",
        duration: 2800
      });
    } finally {
      this._discardVoiceResult = false;
      this.processHardwareVoiceQueue();
    }
  },

  enqueueHardwareRecording(recording) {
    if (!recording || !recording.filePath) return;
    if (this._pageUnloaded) {
      deviceAudioService.removeFile(recording.filePath);
      return;
    }
    this._hardwareVoiceQueue.push(recording);
    this.processHardwareVoiceQueue();
  },

  async processHardwareVoiceQueue() {
    if (this._processingHardwareVoice || this._pageUnloaded) return;
    if (!this._hardwareVoiceQueue || !this._hardwareVoiceQueue.length) return;
    if (this.data.thinking || this.data.speaking || this.data.listening || this.data.recognizing || this.data.loading) return;

    const recording = this._hardwareVoiceQueue.shift();
    this._processingHardwareVoice = true;
    this.setData({ recognizing: true });
    try {
      const response = await chatService.transcribeAudio(recording.filePath, recording.voiceFormat || "wav");
      if (this._pageUnloaded) return;
      const content = response.data && typeof response.data.text === "string"
        ? response.data.text.trim()
        : "";
      if (!content) throw new Error("没有听清，请再说一次");

      this.setData({ recognizing: false, inputValue: "" });
      await this.sendMessage(content);
    } catch (error) {
      if (!this._pageUnloaded) {
        console.error("挂件语音转文字失败：", error);
        this.setData({ recognizing: false });
        wx.showToast({
          title: error.message || "挂件语音识别失败，请重试",
          icon: "none",
          duration: 2800
        });
      }
    } finally {
      deviceAudioService.removeFile(recording.filePath);
      deviceAudioService.markReady();
      this._processingHardwareVoice = false;
      if (!this._pageUnloaded) this.processHardwareVoiceQueue();
    }
  },

  async loadMessages() {
    try {
      const result = await chatService.getMessages();
      this.setData({ messages: result.data.messages, loading: false });
      this.processHardwareVoiceQueue();
    } catch (error) {
      this.handleError(error);
    }
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  sendTextMessage() {
    if (this.data.thinking || this.data.speaking || this.data.loading || this.data.listening || this.data.recognizing) return;

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
    if (this.data.thinking || this.data.speaking || this.data.loading || this.data.recognizing) return;

    if (this.data.listening) {
      this.stopVoiceRecognition(false);
      return;
    }

    this.startVoiceRecognition();
  },

  startVoiceRecognition() {
    if (!this.initVoiceRecorder()) {
      wx.showToast({ title: "录音功能暂不可用", icon: "none" });
      return;
    }

    this._discardVoiceResult = false;
    this.setData({ inputValue: "", listening: true, recognizing: false });

    try {
      this._recorderManager.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3"
      });
    } catch (error) {
      console.error("启动录音失败：", error);
      this.setData({ listening: false, recognizing: false });
      wx.showToast({ title: this.getRecorderErrorMessage(error), icon: "none" });
    }
  },

  stopVoiceRecognition(discardResult) {
    if (!this._recorderManager || (!this.data.listening && !this.data.recognizing)) return;

    this._discardVoiceResult = Boolean(discardResult);
    if (!this.data.listening) {
      if (!this._pageUnloaded) this.setData({ recognizing: false });
      return;
    }
    if (!this._pageUnloaded) {
      this.setData({ listening: false, recognizing: !discardResult });
    }

    try {
      this._recorderManager.stop();
    } catch (error) {
      console.error("停止语音识别失败：", error);
      if (!this._pageUnloaded) {
        this.setData({ listening: false, recognizing: false });
      }
    }
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

      if (deviceTtsService.getState().attached) {
        this.setData({
          thinking: false,
          speaking: true,
          hardwarePlaybackText: "正在生成云团语音…"
        });
        try {
          const speech = await chatService.synthesizeSpeech(result.data.reply);
          await deviceTtsService.play(speech.data);
        } catch (speechError) {
          console.error("挂件朗读失败：", speechError);
          wx.showToast({
            title: speechError.message || "文字回复成功，但朗读失败",
            icon: "none",
            duration: 2800
          });
        } finally {
          if (!this._pageUnloaded) this.setData({ speaking: false });
        }
      }
    } catch (error) {
      console.error("发送聊天消息失败：", error);
      wx.showToast({
        title: error.message || "发送失败，请稍后重试",
        icon: "none",
        duration: 2600
      });
    } finally {
      this.setData({ thinking: false, speaking: false, listening: false });
      this.processHardwareVoiceQueue();
    }
  },

  clearConversation() {
    if (this.data.thinking || this.data.speaking || this.data.loading || this.data.listening || this.data.recognizing) return;

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
    this.setData({ loading: false, listening: false, recognizing: false, thinking: false, speaking: false });
    wx.showToast({
      title: error.message || "操作失败，请重试",
      icon: "none",
      duration: 2200
    });
  }
});

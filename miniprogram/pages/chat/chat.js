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
    generating: false,
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
      const betweenSegments = this.data.speaking &&
        (state.phase === "idle" || state.phase === "complete");
      if (state.phase === "playing" && this._activeVoiceTrace && !this._activeVoiceTrace.firstPlaybackAt) {
        this._activeVoiceTrace.firstPlaybackAt = Date.now();
        this.logVoiceLatency(this._activeVoiceTrace);
      }
      this.setData({
        hardwarePlaybackSupported: state.supported,
        speaking: active || betweenSegments,
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
    if (this._activeChatRequest && typeof this._activeChatRequest.abort === "function") {
      this._activeChatRequest.abort();
    }
    chatService.flushMessages();
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
    const hasInlineAudio = recording &&
      typeof recording.audioBase64 === "string" && Boolean(recording.audioBase64);
    if (!recording || (!recording.filePath && !hasInlineAudio)) return;
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
    if (this.data.generating || this.data.speaking || this.data.listening || this.data.recognizing || this.data.loading) return;

    const recording = this._hardwareVoiceQueue.shift();
    const timing = recording.timing || {};
    const voiceTrace = {
      recordingStartedAt: timing.recordingStartedAt || Date.now() - (recording.durationMs || 0),
      recordingFinishedAt: timing.recordingFinishedAt || timing.completedAt || 0,
      audioReadyAt: timing.completedAt || Date.now(),
      recordingMs: timing.recordingMs || recording.durationMs || 0,
      bleUploadMs: timing.transferMs || 0,
      bleMtu: timing.mtu || 0,
      bleChunkPayload: timing.chunkPayload || 0,
      blePacketCount: timing.totalChunks || 0,
      bleEncodedBytes: timing.encodedBytes || 0
    };
    this._processingHardwareVoice = true;
    this.setData({ recognizing: true, hardwareVoiceText: "录音已接收，正在识别…" });
    try {
      const asrStartedAt = Date.now();
      let response;
      if (recording.realtimeTranscriptPromise) {
        try {
          const text = await recording.realtimeTranscriptPromise;
          response = { code: 0, message: "success", data: { text } };
          voiceTrace.asrMode = "realtime";
        } catch (realtimeError) {
          console.warn("实时语音识别失败，改用完整录音识别：", realtimeError.message);
        }
      }
      if (!response) {
        response = await chatService.transcribeAudio(
          recording.filePath,
          recording.voiceFormat || "wav",
          recording.audioBase64
        );
        voiceTrace.asrMode = "sentence-fallback";
      }
      voiceTrace.asrMs = Date.now() - asrStartedAt;
      if (this._pageUnloaded) return;
      const content = response.data && typeof response.data.text === "string"
        ? response.data.text.trim()
        : "";
      if (!content) throw new Error("没有听清，请再说一次");

      this.setData({ recognizing: false, inputValue: "", hardwareVoiceText: "识别完成，正在生成回复…" });
      await this.sendMessage(content, voiceTrace);
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
      const messages = (result.data.messages || []).map(item =>
        item && item.role === "user" && item.status === "sending"
          ? Object.assign({}, item, {
            status: "failed",
            errorMessage: "上次回复未完成，可点击重试"
          })
          : item
      );
      this.setData({ messages, loading: false });
      chatService.saveMessages(messages);
      this.processHardwareVoiceQueue();
    } catch (error) {
      this.handleError(error);
    }
  },

  onInput(event) {
    this.setData({ inputValue: event.detail.value });
  },

  sendTextMessage() {
    if (this.data.generating || this.data.speaking || this.data.loading || this.data.listening || this.data.recognizing) return;

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
    if (this.data.generating || this.data.speaking || this.data.loading || this.data.recognizing) return;

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

  async sendMessage(content, voiceTrace, retryOptions) {
    if (this.data.generating) return;

    const retry = retryOptions || {};
    const requestId = retry.requestId || chatService.createRequestId();
    const userId = retry.userMessageId || `user-${Date.now()}`;
    let userMessages;
    if (retry.userMessageId) {
      userMessages = this.data.messages
        .filter(item => item.replyTo !== retry.userMessageId)
        .map(item => item.id === retry.userMessageId
          ? Object.assign({}, item, { status: "sending", errorMessage: "", requestId })
          : item);
    } else {
      userMessages = this.data.messages.concat({
        id: userId,
        role: "user",
        content,
        status: "sending",
        requestId
      });
    }
    this._generationCancelled = false;
    this.setData({
      thinking: true,
      generating: true,
      messages: userMessages
    });
    chatService.saveMessages(userMessages);
    this.scrollToBottom();

    try {
      const replyStartedAt = Date.now();
      if (chatService.canStreamMessage()) {
        try {
          await this.receiveStreamingReply(
            content,
            userMessages,
            voiceTrace,
            replyStartedAt,
            userId,
            requestId
          );
          return;
        } catch (streamError) {
          if (!streamError.canFallback || streamError.partialReply) throw streamError;
          console.warn("流式聊天不可用，自动切换普通聊天：", streamError.message);
          if (!this._pageUnloaded) {
            this.setData({
              thinking: true,
              hardwarePlaybackText: voiceTrace ? "流式服务不可用，正在用普通模式回复…" : this.data.hardwarePlaybackText
            });
          }
        }
      }

      await this.receiveCompleteReply(
        content,
        userMessages,
        voiceTrace,
        replyStartedAt,
        userId,
        requestId
      );
    } catch (error) {
      console.error("发送聊天消息失败：", error);
      if (!this._pageUnloaded) {
        const errorMessage = error.cancelled ? "已停止生成，可点击重试" : (error.message || "发送失败，请稍后重试");
        const failedMessages = this.data.messages.map(item => item.id === userId
          ? Object.assign({}, item, { status: "failed", errorMessage, requestId })
          : item);
        this.setData({ messages: failedMessages });
        chatService.saveMessages(failedMessages);
        if (!error.cancelled) {
          wx.showToast({ title: errorMessage, icon: "none", duration: 2600 });
        }
      }
    } finally {
      this._activeChatRequest = null;
      if (!this._pageUnloaded) {
        this.setData({ generating: false, thinking: false, speaking: false, listening: false });
        this.processHardwareVoiceQueue();
      }
    }
  },

  async receiveCompleteReply(content, userMessages, voiceTrace, replyStartedAt, userId, requestId) {
    // 普通云函数仍作为低版本基础库、未部署 HTTP 函数或上游不支持 SSE 时的降级链路。
    const result = await chatService.sendMessage(content, userMessages.slice(0, -1), requestId);
    if (this._generationCancelled) {
      const cancelled = new Error("已停止生成");
      cancelled.cancelled = true;
      throw cancelled;
    }
    if (voiceTrace) voiceTrace.aiAndNetworkMs = Date.now() - replyStartedAt;
    if (!result.data || !result.data.reply) {
      throw new Error("AI 没有返回有效回复");
    }

    const reply = {
      id: `ai-${Date.now()}`,
      role: "assistant",
      content: result.data.reply,
      replyTo: userId,
      status: "done"
    };
    const sentMessages = userMessages.map(item => item.id === userId
      ? Object.assign({}, item, { status: "sent", errorMessage: "" })
      : item);
    const replyMessages = sentMessages.concat(reply);
    this.setData({ messages: replyMessages, generating: false, thinking: false });
    chatService.saveMessages(replyMessages);
    this.scrollToBottom();

    if (deviceTtsService.getState().attached) {
      this.setData({
        thinking: false,
        speaking: true,
        hardwarePlaybackText: "正在生成云团语音…"
      });
      try {
        await this.playReplySpeech(result.data.reply, voiceTrace);
      } catch (speechError) {
        console.error("挂件朗读失败：", speechError);
        wx.showToast({
          title: speechError.message || "文字回复成功，但朗读失败",
          icon: "none",
          duration: 2800
        });
      } finally {
        if (voiceTrace && this._activeVoiceTrace === voiceTrace) this._activeVoiceTrace = null;
        if (!this._pageUnloaded) this.setData({ speaking: false });
      }
    }
  },

  async receiveStreamingReply(content, userMessages, voiceTrace, replyStartedAt, userId, requestId) {
    const replyId = `ai-stream-${Date.now()}`;
    const speechQueue = deviceTtsService.getState().attached
      ? this.createStreamingSpeechQueue(voiceTrace)
      : null;
    let partialReply = "";
    let firstSegmentReceived = false;

    try {
      const operation = chatService.streamMessage(
        content,
        userMessages.slice(0, -1),
        {
          onSegment: segment => {
            if (this._pageUnloaded) return;
            partialReply += segment;
            if (!firstSegmentReceived) {
              firstSegmentReceived = true;
              if (voiceTrace) voiceTrace.aiAndNetworkMs = Date.now() - replyStartedAt;
            }
            const replyMessages = userMessages.concat({
              id: replyId,
              role: "assistant",
              content: partialReply,
              replyTo: userId,
              status: "streaming"
            });
            this.setData({
              messages: replyMessages,
              // 未连接挂件时继续用 thinking 锁住输入，直到完整流结束，避免消息并发乱序。
              thinking: !speechQueue,
              speaking: Boolean(speechQueue),
              hardwarePlaybackText: speechQueue
                ? "已收到首段，正在生成云团语音…"
                : this.data.hardwarePlaybackText
            });
            chatService.scheduleSaveMessages(replyMessages);
            this.scrollToBottom();
            if (speechQueue) speechQueue.enqueue(segment);
          }
        },
        requestId
      );
      this._activeChatRequest = operation;
      const result = await operation;
      if (this._generationCancelled) {
        const cancelled = new Error("已停止生成");
        cancelled.cancelled = true;
        cancelled.partialReply = partialReply;
        throw cancelled;
      }

      if (!firstSegmentReceived && voiceTrace) {
        voiceTrace.aiAndNetworkMs = Date.now() - replyStartedAt;
      }
      const finalReply = result.data && result.data.reply;
      if (!finalReply) throw new Error("AI 没有返回有效回复");

      const sentMessages = userMessages.map(item => item.id === userId
        ? Object.assign({}, item, { status: "sent", errorMessage: "" })
        : item);
      const finalMessages = sentMessages.concat({
        id: replyId,
        role: "assistant",
        content: finalReply,
        replyTo: userId,
        status: "done"
      });
      if (!this._pageUnloaded) {
        this.setData({ messages: finalMessages, generating: false, thinking: false });
        chatService.saveMessages(finalMessages);
        this.scrollToBottom();
      }

      if (speechQueue) {
        try {
          await speechQueue.finish();
        } catch (speechError) {
          console.error("流式挂件朗读失败：", speechError);
          wx.showToast({
            title: speechError.message || "文字回复成功，但朗读失败",
            icon: "none",
            duration: 2800
          });
        } finally {
          if (voiceTrace && this._activeVoiceTrace === voiceTrace) this._activeVoiceTrace = null;
        }
      }
      return result;
    } catch (error) {
      error.partialReply = error.partialReply || partialReply;
      if (speechQueue && partialReply) {
        try {
          await speechQueue.finish();
        } catch (speechError) {
          console.error("部分流式回复朗读失败：", speechError);
        }
      }
      throw error;
    }
  },

  stopGeneration() {
    if (!this.data.generating) return;
    this._generationCancelled = true;
    if (this._activeChatRequest && typeof this._activeChatRequest.abort === "function") {
      this._activeChatRequest.abort();
    }
    this.setData({ thinking: false });
  },

  retryMessage(event) {
    if (this.data.generating || this.data.speaking || this.data.loading) return;
    const messageId = event.currentTarget.dataset.messageId;
    const item = this.data.messages.find(message => message.id === messageId);
    if (!item || item.role !== "user" || item.status !== "failed") return;
    this.sendMessage(item.content, null, {
      userMessageId: item.id,
      requestId: item.requestId || chatService.createRequestId()
    });
  },

  createStreamingSpeechQueue(voiceTrace) {
    const maximumCharacters = 150;
    const maximumSegments = 4;
    let queuedCharacters = 0;
    let segmentNumber = 0;
    let playbackChain = Promise.resolve();

    return {
      enqueue: text => {
        const available = maximumCharacters - queuedCharacters;
        if (available <= 0 || segmentNumber >= maximumSegments) return;
        const speechText = Array.from(typeof text === "string" ? text : "")
          .slice(0, available)
          .join("")
          .trim();
        if (!speechText) return;

        queuedCharacters += Array.from(speechText).length;
        segmentNumber += 1;
        const currentSegment = segmentNumber;
        const synthesisStartedAt = Date.now();
        // 句段到达即开始云端合成；用包装结果立即接住失败，避免并发 Promise 未处理。
        const prepared = chatService.synthesizeSpeech(speechText).then(
          result => ({ result }),
          error => ({ error })
        );

        playbackChain = playbackChain.then(async () => {
          const synthesized = await prepared;
          if (synthesized.error) throw synthesized.error;
          if (currentSegment === 1 && voiceTrace) {
            voiceTrace.firstSpeechReadyAt = Date.now();
            voiceTrace.firstSpeechSynthesisMs = voiceTrace.firstSpeechReadyAt - synthesisStartedAt;
            this._activeVoiceTrace = voiceTrace;
          }
          if (!this._pageUnloaded) {
            this.setData({
              speaking: true,
              hardwarePlaybackText: currentSegment === 1
                ? "首段语音已生成，正在发送到挂件…"
                : `正在播放后续语音 ${currentSegment}`
            });
          }
          await deviceTtsService.play(synthesized.result.data);
        });
      },
      finish: async () => {
        await playbackChain;
        if (voiceTrace) {
          voiceTrace.completedAt = Date.now();
          voiceTrace.totalPipelineMs = voiceTrace.completedAt - voiceTrace.recordingStartedAt;
          if (this._activeVoiceTrace === voiceTrace) this._activeVoiceTrace = null;
        }
      }
    };
  },

  async playReplySpeech(text, voiceTrace) {
    const segments = chatService.splitSpeechText(text);
    if (!segments.length) throw new Error("没有可朗读的回复");

    const synthesisStartedAt = Date.now();
    const firstPromise = chatService.synthesizeSpeech(segments[0]).then(
      result => ({ result }),
      error => ({ error })
    );

    const first = await firstPromise;
    if (first.error) throw first.error;
    // 第一段优先独占云端合成；拿到首段后，再让后续合成与 BLE 下发、播放并行。
    const remainingPromise = segments.length > 1
      ? chatService.synthesizeSpeechBatch(segments.slice(1)).then(
        result => ({ result }),
        error => ({ error })
      )
      : null;
    if (voiceTrace) {
      voiceTrace.firstSpeechReadyAt = Date.now();
      voiceTrace.firstSpeechSynthesisMs = voiceTrace.firstSpeechReadyAt - synthesisStartedAt;
      this._activeVoiceTrace = voiceTrace;
    }
    this.setData({ hardwarePlaybackText: "首段语音已生成，正在发送到挂件…" });
    await deviceTtsService.play(first.result.data);

    if (remainingPromise) {
      const remaining = await remainingPromise;
      if (remaining.error) throw remaining.error;
      const audioSegments = remaining.result.data && remaining.result.data.segments;
      if (!Array.isArray(audioSegments) || audioSegments.length !== segments.length - 1) {
        throw new Error("后续语音生成结果不完整");
      }
      for (let index = 0; index < audioSegments.length; index += 1) {
        this.setData({ hardwarePlaybackText: `正在播放后续语音 ${index + 2}/${segments.length}` });
        await deviceTtsService.play(audioSegments[index]);
      }
    }
    if (voiceTrace) {
      voiceTrace.completedAt = Date.now();
      voiceTrace.totalPipelineMs = voiceTrace.completedAt - voiceTrace.recordingStartedAt;
      this._activeVoiceTrace = null;
    }
  },

  logVoiceLatency(trace) {
    const firstPlaybackAt = trace.firstPlaybackAt || Date.now();
    const metrics = {
      recordingMs: trace.recordingMs || 0,
      bleUploadMs: trace.bleUploadMs || 0,
      bleMtu: trace.bleMtu || 0,
      bleChunkPayload: trace.bleChunkPayload || 0,
      blePacketCount: trace.blePacketCount || 0,
      bleEncodedBytes: trace.bleEncodedBytes || 0,
      asrMode: trace.asrMode || "unknown",
      asrMs: trace.asrMs || 0,
      aiAndNetworkMs: trace.aiAndNetworkMs || 0,
      firstSpeechSynthesisMs: trace.firstSpeechSynthesisMs || 0,
      bleDownlinkToPlaybackMs: trace.firstSpeechReadyAt ? firstPlaybackAt - trace.firstSpeechReadyAt : 0,
      pressToFirstPlaybackMs: firstPlaybackAt - trace.recordingStartedAt
    };
    console.info("[VOICE_LATENCY] 挂件语音首包播放耗时", metrics);
  },

  clearConversation() {
    if (this.data.generating || this.data.speaking || this.data.loading || this.data.listening || this.data.recognizing) return;

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

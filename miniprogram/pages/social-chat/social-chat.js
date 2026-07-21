const socialService = require("../../services/social");
const socialChatCache = require("../../services/social-chat-cache");
const {
  EMPTY_CONTACT_EXCHANGE,
  EMPTY_MESSAGE_POLICY,
  normalizeMessagePolicy,
  normalizeContactExchange,
  contactExchangeSummary,
  soloTestActionMessage,
  isRelationshipEndedError,
  decorateMessages,
  mergeMessages,
  conversationSignature
} = require("./social-chat-helpers");
const ACTIVE_REFRESH_MS = 5000;
const MAX_REFRESH_MS = 30000;

const DEFAULT_PROFILE = {
  avatarType: "virtual",
  avatarValue: "友",
  avatarColor: "#DFECE5",
  nickname: "伙伴",
  bio: "",
  tags: []
};

const REPORT_OPTIONS = [
  { label: "垃圾广告", value: "spam" },
  { label: "骚扰辱骂", value: "harassment" },
  { label: "疑似诈骗", value: "fraud" },
  { label: "不当内容", value: "inappropriate" },
  { label: "其他问题", value: "other" }
];

Page({
  data: {
    conversationId: "",
    loading: true,
    relationshipEnded: false,
    profile: DEFAULT_PROFILE,
    messages: [],
    hasMoreMessages: false,
    messageCursor: 0,
    loadingMoreMessages: false,
    inputValue: "",
    sending: false,
    showEmojis: false,
    emojis: ["😊", "👋", "🌷", "👍", "☕", "🎵", "📷", "🏸"],
    prompts: ["你好，很高兴认识你", "我们好像有共同兴趣，有机会一起聊聊吧", "有空一起散步吗"],
    scrollTarget: "",
    messagePolicy: EMPTY_MESSAGE_POLICY,
    contactExchange: EMPTY_CONTACT_EXCHANGE,
    contactSummary: "双方已同意，按需选择分享",
    contactSaving: false,
    soloTestOperating: false
  },

  onLoad(options) {
    const conversationId = decodeURIComponent(String(options && options.conversationId || ""));
    if (!/^[a-f0-9]{64}$/.test(conversationId)) {
      wx.showToast({ title: "会话编号无效", icon: "none" });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ conversationId });
    this.restoreCachedConversation();
  },

  onShow() {
    this._pageActive = true;
    this._refreshDelay = ACTIVE_REFRESH_MS;
    this.setForegroundView("chat");
    this.stopRefreshTimer();
    if (this._conversationLoaded && socialChatCache.isFresh(this._lastConversationSyncAt)) {
      const remainingFreshTime = socialChatCache.CACHE_FRESH_MS -
        (Date.now() - this._lastConversationSyncAt);
      this.scheduleRefresh(Math.max(ACTIVE_REFRESH_MS, remainingFreshTime));
      return;
    }
    this.loadConversation(this._conversationLoaded).finally(() => this.scheduleRefresh(ACTIVE_REFRESH_MS));
  },

  onHide() { this.leavePage(); },
  onUnload() { this.leavePage(); },
  onPullDownRefresh() { this.loadConversation(); },

  stopRefreshTimer() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = null;
  },

  scheduleRefresh(delay) {
    this.stopRefreshTimer();
    if (!this._pageActive || this.data.relationshipEnded) return;
    this._refreshTimer = setTimeout(async () => {
      const changed = await this.loadConversation(true);
      this._refreshDelay = changed
        ? ACTIVE_REFRESH_MS
        : Math.min(MAX_REFRESH_MS, Math.max(ACTIVE_REFRESH_MS, this._refreshDelay * 2));
      this.scheduleRefresh(this._refreshDelay);
    }, Math.max(ACTIVE_REFRESH_MS, Number(delay) || ACTIVE_REFRESH_MS));
  },

  wakeRefresh() {
    this._refreshDelay = ACTIVE_REFRESH_MS;
    this.scheduleRefresh(ACTIVE_REFRESH_MS);
  },

  leavePage() {
    this._pageActive = false;
    this.stopRefreshTimer();
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.clearSocialForegroundView === "function") {
      app.clearSocialForegroundView("chat");
    }
  },

  setForegroundView(value) {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.setSocialForegroundView === "function") {
      app.setSocialForegroundView(value);
    }
  },

  restoreCachedConversation() {
    const cached = socialChatCache.readConversation(this.data.conversationId);
    if (!cached) return false;
    const profile = cached.profile || DEFAULT_PROFILE;
    const messages = decorateMessages(cached.messages);
    const contactExchange = normalizeContactExchange(cached.contactExchange);
    const messagePolicy = normalizeMessagePolicy(cached.messagePolicy);
    this.setData({
      loading: false,
      relationshipEnded: false,
      profile,
      messages,
      hasMoreMessages: cached.hasMoreMessages === true,
      messageCursor: Number(cached.messageCursor) || 0,
      messagePolicy,
      contactExchange,
      contactSummary: contactExchangeSummary(contactExchange),
      scrollTarget: messages.length ? `message-${messages[messages.length - 1].id}` : ""
    });
    this._conversationLoaded = true;
    this._lastConversationSyncAt = Number(cached.syncedAt) || 0;
    wx.setNavigationBarTitle({ title: profile.nickname || "伙伴聊天" });
    return true;
  },

  persistConversationCache(overrides) {
    const state = Object.assign({
      profile: this.data.profile,
      messages: this.data.messages,
      hasMoreMessages: this.data.hasMoreMessages,
      messageCursor: this.data.messageCursor,
      messagePolicy: this.data.messagePolicy,
      contactExchange: this.data.contactExchange,
      syncedAt: this._lastConversationSyncAt
    }, overrides || {});
    socialChatCache.writeConversation(this.data.conversationId, state);
  },

  async loadConversation(silent, scrollToBottom) {
    if (!this.data.conversationId || this._loadingConversation || this.data.relationshipEnded) return false;
    this._loadingConversation = true;
    const beforeSignature = conversationSignature(
      this.data.messages,
      this.data.contactExchange,
      this.data.messagePolicy
    );
    try {
      const latestMessage = this.data.messages[this.data.messages.length - 1];
      const afterCreatedAt = this._conversationLoaded && latestMessage
        ? (Number(latestMessage.createdAt) || 0)
        : 0;
      const result = await socialService.getConversation(this.data.conversationId, {
        pageSize: 30,
        afterCreatedAt
      });
      const profile = result.conversation && result.conversation.profile
        ? result.conversation.profile
        : DEFAULT_PROFILE;
      const pageMessages = decorateMessages(result.messages);
      const firstLoad = !this._conversationLoaded;
      const messages = firstLoad
        ? pageMessages
        : mergeMessages(this.data.messages, pageMessages);
      const pagination = result.pagination || {};
      const contactExchange = normalizeContactExchange(result.contactExchange);
      const messagePolicy = normalizeMessagePolicy(result.messagePolicy);
      const tag = profile.tags && profile.tags[0];
      const nextData = {
        loading: false,
        relationshipEnded: false,
        profile,
        messages,
        hasMoreMessages: firstLoad ? pagination.hasMore === true : this.data.hasMoreMessages,
        messageCursor: firstLoad ? (Number(pagination.nextCursor) || 0) : this.data.messageCursor,
        messagePolicy,
        contactExchange,
        contactSummary: contactExchangeSummary(contactExchange),
        prompts: [
          "你好，很高兴认识你",
          tag ? `看到你也喜欢${tag}，有机会一起聊聊吧` : "我们好像有共同兴趣，有机会一起聊聊吧",
          "有空一起散步吗"
        ],
        scrollTarget: (firstLoad || scrollToBottom) && messages.length
          ? `message-${messages[messages.length - 1].id}`
          : this.data.scrollTarget
      };
      this.setData(nextData);
      this._conversationLoaded = true;
      this._lastConversationSyncAt = Date.now();
      this.persistConversationCache(nextData);
      const changed = beforeSignature !== conversationSignature(messages, contactExchange, messagePolicy);
      wx.setNavigationBarTitle({ title: profile.nickname || "伙伴聊天" });
      if (!silent) {
        const app = typeof getApp === "function" ? getApp() : null;
        if (app && typeof app.refreshSocialBadge === "function") app.refreshSocialBadge(true);
      }
      return changed;
    } catch (error) {
      this.setData({ loading: false });
      if (isRelationshipEndedError(error)) this.handleRelationshipEnded();
      else if (!silent) wx.showToast({ title: error.message || "会话加载失败", icon: "none" });
      return false;
    } finally {
      this._loadingConversation = false;
      wx.stopPullDownRefresh();
    }
  },

  async loadEarlierMessages() {
    if (this.data.loadingMoreMessages || !this.data.hasMoreMessages || !this.data.messageCursor) return;
    const anchor = this.data.messages[0] && this.data.messages[0].id;
    this.setData({ loadingMoreMessages: true });
    try {
      const result = await socialService.getConversation(this.data.conversationId, {
        beforeCreatedAt: this.data.messageCursor,
        pageSize: 30
      });
      const olderMessages = decorateMessages(result.messages);
      const pagination = result.pagination || {};
      this.setData({
        messages: mergeMessages(olderMessages, this.data.messages),
        hasMoreMessages: pagination.hasMore === true,
        messageCursor: Number(pagination.nextCursor) || 0,
        scrollTarget: ""
      }, () => {
        if (anchor) this.setData({ scrollTarget: `message-${anchor}` });
      });
      this._lastConversationSyncAt = Date.now();
      this.persistConversationCache();
    } catch (error) {
      wx.showToast({ title: error.message || "更早消息加载失败", icon: "none" });
    } finally {
      this.setData({ loadingMoreMessages: false });
    }
  },

  handleRelationshipEnded() {
    this.stopRefreshTimer();
    socialChatCache.removeConversation(this.data.conversationId);
    this.setData({ relationshipEnded: true, sending: false, showEmojis: false });
    if (this._relationshipNoticeShown) return;
    this._relationshipNoticeShown = true;
    wx.showModal({
      title: "伙伴关系已解除",
      content: "这段会话已经结束，双方都不能再发送消息。",
      showCancel: false,
      confirmText: "返回伙伴页",
      success: () => wx.navigateBack()
    });
  },

  onInput(event) {
    this.setData({ inputValue: String(event.detail.value || "") });
  },

  usePrompt(event) {
    if (this.data.messagePolicy.blocked) return;
    const content = String(event.currentTarget.dataset.content || "");
    this._pendingRequest = null;
    this.setData({ inputValue: content, showEmojis: false });
  },

  toggleEmojis() {
    if (this.data.relationshipEnded || this.data.messagePolicy.blocked) return;
    this.setData({ showEmojis: !this.data.showEmojis });
  },

  appendEmoji(event) {
    if (this.data.messagePolicy.blocked) return;
    const emoji = String(event.currentTarget.dataset.emoji || "");
    const current = String(this.data.inputValue || "");
    if (Array.from(current + emoji).length > 300) return;
    this._pendingRequest = null;
    this.setData({ inputValue: current + emoji });
  },

  async sendMessage() {
    const content = String(this.data.inputValue || "").trim();
    if (this.data.relationshipEnded) return;
    if (this.data.messagePolicy.blocked) {
      wx.showToast({ title: "已发送 3 条，请等待对方回复", icon: "none" });
      return;
    }
    if (!content) {
      wx.showToast({ title: "消息不能为空", icon: "none" });
      return;
    }
    if (Array.from(content).length > 300) {
      wx.showToast({ title: "消息不能超过 300 个字符", icon: "none" });
      return;
    }
    if (this.data.sending) return;

    if (!this._pendingRequest || this._pendingRequest.content !== content) {
      this._pendingRequest = { content, requestId: socialService.createSocialRequestId() };
    }
    const pending = this._pendingRequest;
    this.setData({ sending: true, showEmojis: false });
    try {
      const result = await socialService.sendSocialMessage(
        this.data.conversationId,
        pending.content,
        pending.requestId
      );
      this._pendingRequest = null;
      const sentMessages = decorateMessages(result && result.message ? [result.message] : []);
      const messages = mergeMessages(this.data.messages, sentMessages);
      const currentPolicy = this.data.messagePolicy || EMPTY_MESSAGE_POLICY;
      const messagePolicy = currentPolicy.limited
        ? normalizeMessagePolicy({
          limited: true,
          remainingBeforeReply: Math.max(0, Number(currentPolicy.remainingBeforeReply) - 1)
        })
        : currentPolicy;
      this._lastConversationSyncAt = Date.now();
      this.setData({
        inputValue: "",
        messages,
        messagePolicy,
        scrollTarget: messages.length ? `message-${messages[messages.length - 1].id}` : ""
      });
      this.persistConversationCache({ messages, messagePolicy });
      this.wakeRefresh();
    } catch (error) {
      if (isRelationshipEndedError(error)) this.handleRelationshipEnded();
      else wx.showToast({ title: error.message || "发送失败，请重试", icon: "none" });
    } finally {
      this.setData({ sending: false });
    }
  },

  openSoloTestMenu() {
    if (!this.data.profile.isSoloTest || this.data.relationshipEnded || this.data.soloTestOperating) return;
    const items = [{ label: "让测试伙伴发一条消息", action: "message" }];
    const status = this.data.contactExchange.status;
    if (status === "none" || status === "declined") {
      items.push({ label: "让测试伙伴申请交换联系方式", action: "request_contact" });
    } else if (status === "pending_sent") {
      items.push({ label: "让测试伙伴同意我的申请", action: "accept_contact" });
    } else if (status === "accepted" && !this.data.contactExchange.peerContact) {
      items.push({ label: "让测试伙伴分享测试微信号", action: "share_contact" });
    }
    wx.showActionSheet({
      itemList: items.map(item => item.label),
      success: result => {
        const selected = items[result.tapIndex];
        if (selected) this.runSoloTestAction(selected.action);
      }
    });
  },

  async runSoloTestAction(action) {
    if (this.data.soloTestOperating) return;
    this.setData({ soloTestOperating: true });
    try {
      await socialService.runSoloTestPeerAction(this.data.conversationId, action);
      await this.loadConversation(true, true);
      this.wakeRefresh();
      wx.showToast({ title: soloTestActionMessage(action), icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "测试伙伴操作失败", icon: "none" });
    } finally {
      this.setData({ soloTestOperating: false });
    }
  },

  openSafetyMenu() {
    wx.showActionSheet({
      itemList: ["交换联系方式", "清空我这边的聊天记录", "解除伙伴关系", "屏蔽此用户", "举报说明"],
      success: result => {
        const actions = [
          () => this.openContactExchange(),
          () => this.confirmClearConversation(),
          () => this.confirmEndRelationship(),
          () => this.confirmBlockUser(),
          () => this.showReportHelp()
        ];
        if (actions[result.tapIndex]) actions[result.tapIndex]();
      }
    });
  },

  openContactExchange() {
    const status = this.data.contactExchange.status;
    if (status === "none" || status === "declined") {
      wx.showModal({
        title: "申请交换联系方式",
        content: "对方明确同意后，双方才能各自选择是否分享微信号、手机号或二维码。",
        confirmText: "发送申请",
        success: result => { if (result.confirm) this.requestContactExchange(); }
      });
      return;
    }
    if (status !== "accepted") {
      wx.showToast({
        title: status === "pending_sent" ? "等待对方同意交换" : "请先处理对方的交换申请",
        icon: "none"
      });
      return;
    }
    wx.navigateTo({
      url: `/pages/social-contact/social-contact?conversationId=${encodeURIComponent(this.data.conversationId)}`
    });
  },

  async requestContactExchange() {
    try {
      const result = await socialService.requestContactExchange(this.data.conversationId);
      const contactExchange = normalizeContactExchange(result.contactExchange);
      this.setData({ contactExchange, contactSummary: contactExchangeSummary(contactExchange) });
      this._lastConversationSyncAt = Date.now();
      this.persistConversationCache({ contactExchange });
      wx.showToast({ title: "申请已发送", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "申请发送失败", icon: "none" });
    }
  },

  async respondContactExchange(event) {
    const accept = event.currentTarget.dataset.accept === true || event.currentTarget.dataset.accept === "true";
    if (this.data.contactSaving) return;
    this.setData({ contactSaving: true });
    try {
      const result = await socialService.respondContactExchange(this.data.conversationId, accept);
      const contactExchange = normalizeContactExchange(result.contactExchange);
      this.setData({
        contactExchange,
        contactSummary: contactExchangeSummary(contactExchange)
      });
      this._lastConversationSyncAt = Date.now();
      this.persistConversationCache({ contactExchange });
      wx.showToast({ title: accept ? "已同意，可按需分享联系方式" : "已拒绝申请", icon: "none" });
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    } finally {
      this.setData({ contactSaving: false });
    }
  },

  async cancelContactExchange() {
    if (this.data.contactSaving) return;
    this.setData({ contactSaving: true });
    try {
      const result = await socialService.cancelContactExchange(this.data.conversationId);
      const contactExchange = normalizeContactExchange(result.contactExchange);
      this.setData({
        contactExchange,
        contactSummary: contactExchangeSummary(contactExchange)
      });
      this._lastConversationSyncAt = Date.now();
      this.persistConversationCache({ contactExchange });
      wx.showToast({ title: "申请已撤回", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "撤回申请失败", icon: "none" });
    } finally {
      this.setData({ contactSaving: false });
    }
  },

  confirmClearConversation() {
    wx.showModal({
      title: "清空聊天记录",
      content: "只清空你这边当前显示的消息，不会删除对方保存的内容。之后的新消息仍会正常显示。",
      confirmText: "清空",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.clearConversation(); }
    });
  },

  async clearConversation() {
    try {
      await socialService.clearConversationForMe(this.data.conversationId);
      this.setData({
        messages: [],
        hasMoreMessages: false,
        messageCursor: 0,
        scrollTarget: ""
      });
      this._lastConversationSyncAt = Date.now();
      this.persistConversationCache({
        messages: [],
        hasMoreMessages: false,
        messageCursor: 0
      });
      wx.showToast({ title: "已清空我这边的记录", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "清空失败", icon: "none" });
    }
  },

  confirmEndRelationship() {
    wx.showModal({
      title: "解除伙伴关系",
      content: "解除后双方都不能继续发送消息，已共享的联系方式也会从云端撤回。",
      confirmText: "解除关系",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.endRelationship(); }
    });
  },

  async endRelationship() {
    try {
      await socialService.endRelationship(this.data.conversationId);
      socialChatCache.removeConversation(this.data.conversationId);
      wx.showToast({ title: "伙伴关系已解除", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "解除关系失败", icon: "none" });
    }
  },

  confirmBlockUser() {
    wx.showModal({
      title: "屏蔽此用户",
      content: "屏蔽会同时解除伙伴关系。双方不能继续聊天、互看联系方式或通过附近相遇重新打招呼。",
      confirmText: "确认屏蔽",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.blockUser(); }
    });
  },

  async blockUser() {
    try {
      await socialService.blockUser(this.data.conversationId);
      socialChatCache.removeConversation(this.data.conversationId);
      wx.showToast({ title: "已屏蔽", icon: "success" });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "屏蔽失败", icon: "none" });
    }
  },

  showReportHelp() {
    wx.showModal({
      title: "如何举报消息",
      content: "长按对方发送的具体消息，选择举报原因。举报不会自动把对方加入屏蔽列表。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  reportMessage(event) {
    if (event.currentTarget.dataset.sender !== "peer") return;
    const messageId = String(event.currentTarget.dataset.id || "");
    wx.showActionSheet({
      itemList: REPORT_OPTIONS.map(item => item.label),
      success: result => {
        const option = REPORT_OPTIONS[result.tapIndex];
        if (option) this.confirmReportMessage(messageId, option);
      }
    });
  },

  confirmReportMessage(messageId, option) {
    wx.showModal({
      title: `举报：${option.label}`,
      content: "确认提交这条消息及其内容快照供后续处理吗？",
      confirmText: "提交举报",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.submitReport(messageId, option.value); }
    });
  },

  async submitReport(messageId, reason) {
    try {
      await socialService.reportMessage(this.data.conversationId, messageId, reason, "");
      wx.showToast({ title: "举报已提交", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "举报提交失败", icon: "none" });
    }
  }
});

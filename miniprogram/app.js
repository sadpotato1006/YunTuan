const config = require("./config/index");
const socialService = require("./services/social");
const socialInboxCache = require("./services/social-inbox-cache");
const hardwareAiChatService = require("./services/hardware-ai-chat");

App({
  onLaunch() {
    hardwareAiChatService.start();
    // Mock 和 HTTP 模式不初始化云开发，未创建云环境也能正常运行。
    if (!config.usesCloudBackend()) return;
    this._socialBadgePollingActive = true;

    if (!wx.cloud || typeof wx.cloud.init !== "function") {
      console.error("当前基础库不支持微信云开发，请升级基础库版本");
      return;
    }

    // onLaunch 正常只执行一次，额外判断可避免热重载等场景重复初始化。
    if (this.globalData.cloudInitialized) return;

    try {
      const cloudOptions = { traceUser: true };
      if (config.cloudEnvId) cloudOptions.env = config.cloudEnvId;
      wx.cloud.init(cloudOptions);
      this.globalData.cloudInitialized = true;
    } catch (error) {
      this.globalData.cloudInitialized = false;
      console.error("微信云开发初始化失败", error);
    }
  },

  onShow() {
    hardwareAiChatService.setForeground(true);
    this.stopSocialBadgePolling();
    if (!config.usesCloudBackend()) return;
    this._socialBadgePollingActive = true;
    this._socialBadgeIdleRounds = 0;
    this._socialBadgeSignature = "";
    const cachedInbox = socialInboxCache.readInbox();
    if (cachedInbox) this.setSocialBadgeCount(socialInboxCache.badgeCount(cachedInbox));
    const cacheAge = cachedInbox ? Date.now() - Number(cachedInbox.syncedAt || 0) : Infinity;
    const nextRefreshDelay = socialInboxCache.isFresh(cachedInbox)
      ? Math.max(1000, socialInboxCache.CACHE_FRESH_MS - cacheAge)
      : 1200;
    this.scheduleSocialBadgeRefresh(nextRefreshDelay);
  },

  onHide() {
    hardwareAiChatService.setForeground(false);
    this.stopSocialBadgePolling();
  },

  stopSocialBadgePolling() {
    this._socialBadgePollingActive = false;
    if (this._socialBadgeTimer) clearTimeout(this._socialBadgeTimer);
    this._socialBadgeTimer = null;
  },

  scheduleSocialBadgeRefresh(delay) {
    if (!this._socialBadgePollingActive) return;
    if (this._socialBadgeTimer) clearTimeout(this._socialBadgeTimer);
    this._socialBadgeTimer = setTimeout(async () => {
      await this.refreshSocialBadge();
      if (!this._socialBadgePollingActive) return;
      const idleRounds = Math.max(0, Number(this._socialBadgeIdleRounds) || 0);
      const nextDelay = idleRounds >= 4 ? 5 * 60 * 1000 : socialInboxCache.CACHE_FRESH_MS;
      this.scheduleSocialBadgeRefresh(nextDelay);
    }, Math.max(1000, Number(delay) || 30000));
  },

  async refreshSocialBadge(force) {
    if (!force && this.globalData.socialForegroundView) return;
    if (!this.globalData.cloudInitialized || this._socialBadgeLoading) return;
    this._socialBadgeLoading = true;
    try {
      const inbox = await socialService.getSocialInbox();
      const greetings = Array.isArray(inbox.greetings) ? inbox.greetings : [];
      const matches = Array.isArray(inbox.matches) ? inbox.matches : [];
      socialInboxCache.mergeFirstPage(inbox, Date.now());
      const count = socialInboxCache.badgeCount({ greetings, matches });
      const signature = `${count}:${greetings[0] && greetings[0].greetingId || ""}:${matches[0] && matches[0].conversationId || ""}`;
      this._socialBadgeIdleRounds = this._socialBadgeSignature && this._socialBadgeSignature === signature
        ? Math.min(10, (this._socialBadgeIdleRounds || 0) + 1)
        : 0;
      this._socialBadgeSignature = signature;
      this.setSocialBadgeCount(count);
    } catch (error) {
      // 后台轮询失败不打断用户当前操作，进入伙伴页时仍可主动刷新。
      console.warn("伙伴未读状态刷新失败：", error && error.message);
    } finally {
      this._socialBadgeLoading = false;
    }
  },

  setSocialBadgeCount(value) {
    const count = Math.max(0, Number(value) || 0);
    this.globalData.socialBadgeCount = count;
    if (!wx.showTabBarRedDot || !wx.hideTabBarRedDot) return;
    if (count > 0) {
      wx.showTabBarRedDot({ index: 1, fail() {} });
    } else {
      wx.hideTabBarRedDot({ index: 1, fail() {} });
    }
  },

  wakeSocialBadgeRefresh() {
    this._socialBadgeIdleRounds = 0;
    if (this._socialBadgePollingActive) this.scheduleSocialBadgeRefresh(1000);
  },

  setSocialForegroundView(value) {
    this.globalData.socialForegroundView = String(value || "");
  },

  clearSocialForegroundView(value) {
    if (this.globalData.socialForegroundView === String(value || "")) {
      this.globalData.socialForegroundView = "";
    }
  },

  globalData: {
    appName: "云团",
    cloudInitialized: false,
    socialBadgeCount: 0,
    socialForegroundView: ""
  }
});

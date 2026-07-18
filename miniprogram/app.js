const config = require("./config/index");
const socialService = require("./services/social");

App({
  onLaunch() {
    // Mock 和 HTTP 模式不初始化云开发，未创建云环境也能正常运行。
    if (!config.usesCloudBackend()) return;

    if (!config.cloudEnvId) {
      console.warn("云开发环境 ID 未填写，云函数暂不可用");
      return;
    }

    if (!wx.cloud || typeof wx.cloud.init !== "function") {
      console.error("当前基础库不支持微信云开发，请升级基础库版本");
      return;
    }

    // onLaunch 正常只执行一次，额外判断可避免热重载等场景重复初始化。
    if (this.globalData.cloudInitialized) return;

    try {
      wx.cloud.init({ env: config.cloudEnvId, traceUser: true });
      this.globalData.cloudInitialized = true;
    } catch (error) {
      this.globalData.cloudInitialized = false;
      console.error("微信云开发初始化失败", error);
    }
  },

  onShow() {
    this.stopSocialBadgePolling();
    if (!config.usesCloudBackend()) return;
    this._socialBadgeDelay = setTimeout(() => this.refreshSocialBadge(), 1200);
    this._socialBadgeTimer = setInterval(() => this.refreshSocialBadge(), 30000);
  },

  onHide() { this.stopSocialBadgePolling(); },

  stopSocialBadgePolling() {
    if (this._socialBadgeDelay) clearTimeout(this._socialBadgeDelay);
    if (this._socialBadgeTimer) clearInterval(this._socialBadgeTimer);
    this._socialBadgeDelay = null;
    this._socialBadgeTimer = null;
  },

  async refreshSocialBadge(force) {
    if (!force && this.globalData.socialForegroundView) return;
    if (!this.globalData.cloudInitialized || this._socialBadgeLoading) return;
    this._socialBadgeLoading = true;
    try {
      const inbox = await socialService.getSocialInbox();
      const greetings = Array.isArray(inbox.greetings) ? inbox.greetings : [];
      const matches = Array.isArray(inbox.matches) ? inbox.matches : [];
      const count = greetings.length + matches.reduce((total, item) => {
        const unread = Math.max(0, Number(item.unreadCount) || 0);
        return total + unread + (item.newMatch && unread === 0 ? 1 : 0) +
          (item.contactNotice && !item.newMatch ? 1 : 0);
      }, 0);
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
      wx.showTabBarRedDot({ index: 2, fail() {} });
    } else {
      wx.hideTabBarRedDot({ index: 2, fail() {} });
    }
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

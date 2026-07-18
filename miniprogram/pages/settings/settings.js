const profileService = require("../../services/social-profile");
const deviceService = require("../../services/device");
const dataPrivacyService = require("../../services/data-privacy");
const tabSwipe = require("../../utils/tab-swipe");
Page({
  data: {
    deletingCloudData: false,
    tabSwipeStyle: "",
    socialProfile: profileService.toPublicCard(profileService.getProfile())
  },
  onShow() {
    tabSwipe.enter(this, "/pages/settings/settings");
    this.setData({
      socialProfile: profileService.toPublicCard(profileService.getProfile())
    });
  },
  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/settings/settings"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/settings/settings"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); },
  goSocialProfile() {
    wx.navigateTo({ url: "/pages/social-profile/social-profile" });
  },
  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: "AI 聊天文字会通过微信云函数发送给 AI 服务生成回复；云端会保留最近少量 AI 回复，用于断网重试时避免重复计费。使用挂件语音聊天时，录音会发送给腾讯云语音识别服务并转换成文字，回复文字可能发送给腾讯云语音合成服务。情绪记录按当前微信用户保存在微信云数据库中。社交名片会同步到云数据库，相遇时仅展示头像、昵称、介绍、兴趣和社交意愿；打招呼需由对方明确接受后才会建立联系，不提供真实姓名、位置、设备身份或微信 OpenID。确认成为伙伴后，双方主动发送的文字和表情会保存在云数据库中，并且只能由会话双方通过云函数读取。名片设置中的微信号、手机号和二维码预设只保存在当前设备，不随公开名片上传；必须先由一方申请、另一方同意，再由本人针对当前伙伴明确勾选，只有所选内容才会上传并分享。可以撤回云端分享，但无法追回对方已保存或截图的内容。举报会保存被举报消息的必要快照，屏蔽会解除伙伴关系并阻止再次相遇互动。最近相遇及公开名片快照保存在本机，互动凭证最多保留 7 天。您可以在本页删除全部云端数据。",
      showCancel: false,
      confirmText: "知道了"
    });
  },
  showAbout() {
    wx.showModal({ title: "关于云团", content: "云团是一款面向随迁老人的温暖陪伴产品。\n当前版本：前端演示版 1.1.0", showCancel: false, confirmText: "好的" });
  },
  clearLocalData() {
    wx.showModal({
      title: "清除本地数据",
      content: "这会清除本机聊天、相遇记录、设备连接信息、社交名片缓存、未分享的联系方式预设和应用设置；云端情绪记录与已经分享的数据不会删除。确定继续吗？",
      confirmText: "清除",
      confirmColor: "#C06052",
      success: result => {
        if (!result.confirm) return;
        this.clearLocalStorage();
        wx.showToast({ title: "本地数据已清除", icon: "success" });
      }
    });
  },
  deleteCloudData() {
    if (this.data.deletingCloudData) return;
    wx.showModal({
      title: "删除全部个人云端数据",
      content: "将永久删除云端情绪记录、社交名片与头像、已分享的联系方式及二维码、招呼、伙伴关系与聊天消息、屏蔽和举报记录，以及 AI 聊天保护记录；同时清除本机数据。此操作无法撤销，确定继续吗？",
      confirmText: "永久删除",
      confirmColor: "#C06052",
      success: result => {
        if (result.confirm) this.runDeleteCloudData();
      }
    });
  },
  async runDeleteCloudData() {
    this.setData({ deletingCloudData: true });
    wx.showLoading({ title: "正在删除", mask: true });
    try {
      await dataPrivacyService.deleteCloudData();
      this.clearLocalStorage();
      wx.showToast({ title: "全部数据已删除", icon: "success" });
    } catch (error) {
      wx.showModal({
        title: "删除未完成",
        content: `${error.message || "云端数据删除失败"}。可以稍后再次删除。`,
        showCancel: false,
        confirmText: "知道了"
      });
    } finally {
      wx.hideLoading();
      this.setData({ deletingCloudData: false });
    }
  },
  clearLocalStorage() {
    const profile = profileService.getProfile();
    if (profile.avatarType === "custom" && profile.avatarValue &&
        typeof wx.removeSavedFile === "function") {
      wx.removeSavedFile({ filePath: profile.avatarValue, fail() {} });
    }
    deviceService.clearLocalPrivateState();
    wx.clearStorageSync();
    this.setData({
      socialProfile: profileService.toPublicCard(profileService.getProfile())
    });
  }
});

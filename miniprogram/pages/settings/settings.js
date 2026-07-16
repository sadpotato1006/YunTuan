const profileService = require("../../services/social-profile");
const STORAGE_KEY = "yuntuan_settings";
const DEFAULT_SETTINGS = { socialReminder: true, vibration: true, sound: true };
Page({
  data: {
    settings: DEFAULT_SETTINGS,
    socialProfile: profileService.toPublicCard(profileService.getProfile())
  },
  onShow() {
    const saved = wx.getStorageSync(STORAGE_KEY);
    this.setData({
      settings: Object.assign({}, DEFAULT_SETTINGS, saved || {}),
      socialProfile: profileService.toPublicCard(profileService.getProfile())
    });
  },
  updateSetting(event) {
    const key = event.currentTarget.dataset.key;
    const settings = Object.assign({}, this.data.settings, { [key]: event.detail.value });
    this.setData({ settings });
    // 设置写入本地缓存，退出页面后再次进入仍可保留。
    wx.setStorageSync(STORAGE_KEY, settings);
  },
  goSocialProfile() {
    wx.navigateTo({ url: "/pages/social-profile/social-profile" });
  },
  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: "聊天文字会通过微信云函数发送给 AI 服务生成回复；云端会保留最近少量 AI 回复，用于断网重试时避免重复计费。使用语音聊天时，录音会发送给腾讯云语音识别服务并转换成文字，回复文字可能发送给腾讯云语音合成服务。情绪记录按当前微信用户保存在微信云数据库中；设备连接信息、应用设置和社交名片目前只保存在本机。社交名片不包含真实姓名、联系方式、位置、聊天记录或设备身份。",
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
      content: "这会清除聊天记录、情绪记录、社交名片、设备模拟状态和应用设置，确定继续吗？",
      confirmText: "清除",
      confirmColor: "#C06052",
      success: result => {
        if (!result.confirm) return;
        const profile = profileService.getProfile();
        if (profile.avatarType === "custom" && profile.avatarValue &&
            typeof wx.removeSavedFile === "function") {
          wx.removeSavedFile({ filePath: profile.avatarValue, fail() {} });
        }
        wx.clearStorageSync();
        this.setData({
          settings: Object.assign({}, DEFAULT_SETTINGS),
          socialProfile: profileService.toPublicCard(profileService.getProfile())
        });
        wx.showToast({ title: "本地数据已清除", icon: "success" });
      }
    });
  }
});

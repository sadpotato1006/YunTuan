const STORAGE_KEY = "yuntuan_settings";
const DEFAULT_SETTINGS = { socialReminder: true, vibration: true, sound: true };
Page({
  data: { settings: DEFAULT_SETTINGS },
  onShow() {
    const saved = wx.getStorageSync(STORAGE_KEY);
    this.setData({ settings: Object.assign({}, DEFAULT_SETTINGS, saved || {}) });
  },
  updateSetting(event) {
    const key = event.currentTarget.dataset.key;
    const settings = Object.assign({}, this.data.settings, { [key]: event.detail.value });
    this.setData({ settings });
    // 设置写入本地缓存，退出页面后再次进入仍可保留。
    wx.setStorageSync(STORAGE_KEY, settings);
  },
  showPrivacy() {
    wx.showModal({ title: "隐私设置", content: "云团重视您的隐私。当前演示版本仅使用本地模拟数据，不会上传录音或个人信息。", showCancel: false, confirmText: "知道了" });
  },
  showAbout() {
    wx.showModal({ title: "关于云团", content: "云团是一款面向随迁老人的温暖陪伴产品。\n当前版本：前端演示版 1.0.0", showCancel: false, confirmText: "好的" });
  }
});

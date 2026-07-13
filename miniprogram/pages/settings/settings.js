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
    wx.showModal({
      title: "隐私说明",
      content: "聊天文字会发送到微信云函数并由 AI 服务生成回复；当前模拟语音不会录音或上传。设备、情绪和设置数据目前保存在本机。",
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
      content: "这会清除聊天记录、情绪记录、设备模拟状态和应用设置，确定继续吗？",
      confirmText: "清除",
      confirmColor: "#C06052",
      success: result => {
        if (!result.confirm) return;
        wx.clearStorageSync();
        this.setData({ settings: Object.assign({}, DEFAULT_SETTINGS) });
        wx.showToast({ title: "本地数据已清除", icon: "success" });
      }
    });
  }
});

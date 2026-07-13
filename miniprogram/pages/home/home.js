const deviceService = require("../../services/device");
Page({
  data: { loading: true, greeting: "", careTip: "", device: {} },
  onShow() { this.loadOverview(); },
  async loadOverview() {
    try {
      // 页面只通过 service 获取首页业务数据。
      const result = await deviceService.getHomeOverview();
      this.setData(Object.assign({ loading: false }, result.data));
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
  startChat() { wx.navigateTo({ url: "/pages/chat/chat" }); },
  goDevice() { wx.switchTab({ url: "/pages/device/device" }); },
  goEmotion() { wx.switchTab({ url: "/pages/emotion/emotion" }); },
  goSettings() { wx.switchTab({ url: "/pages/settings/settings" }); }
});

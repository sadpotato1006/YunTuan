const deviceService = require("../../services/device");
const emotionService = require("../../services/emotion");
const tabSwipe = require("../../utils/tab-swipe");
Page({
  data: { loading: true, greeting: "", careTip: "", device: {}, latestEmotion: null, tabSwipeStyle: "" },
  onShow() { tabSwipe.enter(this, "/pages/home/home"); this.loadOverview(); },
  async loadOverview() {
    try {
      // 页面只通过 service 获取首页业务数据。
      const [overview, emotion] = await Promise.all([
        deviceService.getHomeOverview(),
        emotionService.getEmotionSummary().catch(error => {
          console.warn("首页情绪摘要暂不可用：", error.message);
          return { code: 0, message: "degraded", data: { latest: null } };
        })
      ]);
      this.setData(Object.assign(
        { loading: false, latestEmotion: emotion.data.latest },
        overview.data
      ));
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    }
  },
  startChat() { wx.navigateTo({ url: "/pages/chat/chat" }); },
  goDevice() { wx.switchTab({ url: "/pages/device/device" }); },
  goEmotion() { wx.switchTab({ url: "/pages/emotion/emotion" }); },
  goSettings() { wx.switchTab({ url: "/pages/settings/settings" }); },
  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/home/home"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/home/home"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); }
});

const emotionService = require("../../services/emotion");
Page({
  data: { loading: true, records: [] },
  onShow() { this.loadRecords(); },
  async loadRecords() {
    try {
      // 情绪记录由 service 提供，替换后端时页面代码无需调整。
      const result = await emotionService.getEmotionRecords();
      this.setData({ records: result.data.records, loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "情绪记录加载失败", icon: "none" });
    }
  }
});

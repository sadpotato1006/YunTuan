const emotionService = require("../../services/emotion");

Page({
  data: {
    loading: true,
    saving: false,
    showCheckIn: false,
    records: [],
    options: []
  },

  onShow() { this.loadRecords(); },

  async loadRecords() {
    try {
      // 情绪记录和选项都由 service 提供，替换后端时页面代码无需调整。
      const [recordsResult, optionsResult] = await Promise.all([
        emotionService.getEmotionRecords(),
        emotionService.getEmotionOptions()
      ]);
      this.setData({
        records: recordsResult.data.records,
        options: optionsResult.data.options,
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "情绪记录加载失败", icon: "none" });
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onPullDownRefresh() { this.loadRecords(); },

  toggleCheckIn() {
    if (this.data.saving) return;
    this.setData({ showCheckIn: !this.data.showCheckIn });
  },

  async selectEmotion(event) {
    if (this.data.saving) return;
    const name = event.currentTarget.dataset.name;
    this.setData({ saving: true });
    try {
      const result = await emotionService.addEmotionRecord(name);
      this.setData({
        records: result.data.records,
        showCheckIn: false
      });
      wx.showToast({ title: "今日心情已记录", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "记录失败，请重试", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});

const emotionService = require("../../services/emotion");

Page({
  data: {
    loading: true,
    saving: false,
    showCheckIn: false,
    selectedEmotion: "",
    noteValue: "",
    noteIsDefault: false,
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
    if (this.data.showCheckIn) {
      this.setData({
        showCheckIn: false,
        selectedEmotion: "",
        noteValue: "",
        noteIsDefault: false
      });
      return;
    }
    const today = formatDate(new Date());
    const todayRecord = this.data.records.find(item => item.date === today);
    const todayOption = todayRecord
      ? this.data.options.find(item => item.name === todayRecord.name)
      : null;
    const noteIsDefault = Boolean(todayRecord && (
      todayRecord.noteCustomized === false ||
      (todayOption && todayRecord.note === todayOption.defaultNote)
    ));
    this.setData({
      showCheckIn: true,
      selectedEmotion: todayRecord ? todayRecord.name : "",
      noteValue: todayRecord && typeof todayRecord.note === "string" ? todayRecord.note : "",
      noteIsDefault
    });
  },

  chooseEmotion(event) {
    if (this.data.saving) return;
    const name = event.currentTarget.dataset.name;
    const option = this.data.options.find(item => item.name === name);
    const shouldUseDefault = this.data.noteIsDefault || !this.data.noteValue.trim();
    this.setData({
      selectedEmotion: name,
      noteValue: shouldUseDefault && option ? option.defaultNote : this.data.noteValue,
      noteIsDefault: shouldUseDefault && Boolean(option)
    });
  },

  onNoteFocus() {
    if (!this.data.noteIsDefault) return;
    this.setData({ noteValue: "", noteIsDefault: false });
  },

  onNoteInput(event) {
    this.setData({ noteValue: event.detail.value, noteIsDefault: false });
  },

  async saveEmotion() {
    if (this.data.saving) return;
    const name = this.data.selectedEmotion;
    if (!name) {
      wx.showToast({ title: "请先选择今天的心情", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const note = this.data.noteIsDefault ? "" : this.data.noteValue;
      const result = await emotionService.addEmotionRecord(name, note);
      this.setData({
        records: result.data.records,
        showCheckIn: false,
        selectedEmotion: "",
        noteValue: "",
        noteIsDefault: false
      });
      wx.showToast({ title: "今日心情已记录", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "记录失败，请重试", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  }
});

function formatDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

const emotionService = require("../../services/emotion");
const tabSwipe = require("../../utils/tab-swipe");

const FALLBACK_DEFAULT_NOTES = {
  "开心": "今天心情很好，想把这份快乐记下来。",
  "平静": "今天心里很安稳，平平淡淡也很好。",
  "一般": "今天心情比较平常，慢慢照顾好自己。",
  "有点低落": "今天有些不开心，希望明天会轻松一点。"
};
const FALLBACK_EMOTION_ICONS = {
  "开心": "😊",
  "平静": "🙂",
  "一般": "😐",
  "有点低落": "😔"
};

Page({
  data: {
    loading: true,
    saving: false,
    showCheckIn: false,
    selectedEmotion: "",
    noteValue: "",
    noteIsDefault: false,
    records: [],
    options: [],
    tabSwipeStyle: ""
  },

  onShow() { tabSwipe.enter(this, "/pages/emotion/emotion"); this.loadRecords(); },

  async loadRecords() {
    try {
      // 情绪记录和选项都由 service 提供，替换后端时页面代码无需调整。
      const [recordsResult, optionsResult] = await Promise.all([
        emotionService.getEmotionRecords(),
        emotionService.getEmotionOptions()
      ]);
      const options = Array.isArray(optionsResult.data.options) ? optionsResult.data.options : [];
      const records = fillMissingDefaultNotes(recordsResult.data.records, options);
      this.setData({
        records,
        options,
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

  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/emotion/emotion"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/emotion/emotion"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); },

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
    this.openCheckIn(false);
  },

  openCheckIn(scrollToTop) {
    const today = formatDate(new Date());
    const todayRecord = this.data.records.find(item => item.date === today);
    const defaultNote = todayRecord ? getDefaultNote(todayRecord.name, this.data.options) : "";
    const noteIsDefault = Boolean(todayRecord && (
      todayRecord.noteCustomized === false ||
      todayRecord.note === defaultNote
    ));
    this.setData({
      showCheckIn: true,
      selectedEmotion: todayRecord ? todayRecord.name : "",
      noteValue: todayRecord && typeof todayRecord.note === "string" ? todayRecord.note : "",
      noteIsDefault
    }, () => {
      if (scrollToTop && typeof wx.pageScrollTo === "function") {
        wx.pageScrollTo({ scrollTop: 0, duration: 250 });
      }
    });
  },

  editTodayRecord(event) {
    if (this.data.saving) return;
    const recordId = event.currentTarget.dataset.id;
    const record = this.data.records.find(item => String(item.id) === String(recordId));
    if (!record || !record.isToday) return;
    this.openCheckIn(true);
  },

  chooseEmotion(event) {
    if (this.data.saving) return;
    const name = event.currentTarget.dataset.name;
    const defaultNote = getDefaultNote(name, this.data.options);
    const shouldUseDefault = this.data.noteIsDefault || !this.data.noteValue.trim();
    this.setData({
      selectedEmotion: name,
      noteValue: shouldUseDefault ? defaultNote : this.data.noteValue,
      noteIsDefault: shouldUseDefault && Boolean(defaultNote)
    });
  },

  onNoteFocus() {
    if (!this.data.noteIsDefault) return;
    this.setData({ noteValue: "", noteIsDefault: false });
  },

  onNoteInput(event) {
    this.setData({ noteValue: event.detail.value, noteIsDefault: false });
  },

  onNoteBlur() {
    const note = typeof this.data.noteValue === "string" ? this.data.noteValue.trim() : "";
    if (note || !this.data.selectedEmotion) return;
    const defaultNote = getDefaultNote(this.data.selectedEmotion, this.data.options);
    if (!defaultNote) return;
    this.setData({ noteValue: defaultNote, noteIsDefault: true });
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
      const enteredNote = typeof this.data.noteValue === "string" ? this.data.noteValue.trim() : "";
      const note = enteredNote || getDefaultNote(name, this.data.options);
      const result = await emotionService.addEmotionRecord(name, note);
      this.setData({
        records: fillMissingDefaultNotes(result.data.records, this.data.options),
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

function getDefaultNote(name, options) {
  const option = Array.isArray(options) ? options.find(item => item.name === name) : null;
  const cloudDefault = option && typeof option.defaultNote === "string" ? option.defaultNote.trim() : "";
  return cloudDefault || FALLBACK_DEFAULT_NOTES[name] || "";
}

function fillMissingDefaultNotes(records, options) {
  const today = formatDate(new Date());
  return (Array.isArray(records) ? records : []).map(record => {
    const note = typeof record.note === "string" ? record.note.trim() : "";
    const option = Array.isArray(options) ? options.find(item => item.name === record.name) : null;
    return Object.assign({}, record, {
      icon: option && option.icon ? option.icon : FALLBACK_EMOTION_ICONS[record.name] || "",
      isToday: record.date === today,
      note: note || getDefaultNote(record.name, options),
      noteCustomized: note ? record.noteCustomized !== false : false
    });
  });
}

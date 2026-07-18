const STORAGE_KEY = "yuntuan_emotion_records";
const DEFAULT_RECORDS = [];
const EMOTION_OPTIONS = [
  { name: "开心", icon: "😊", defaultNote: "今天心情很好，想把这份快乐记下来。" },
  { name: "平静", icon: "🙂", defaultNote: "今天心里很安稳，平平淡淡也很好。" },
  { name: "一般", icon: "😐", defaultNote: "今天心情比较平常，慢慢照顾好自己。" },
  { name: "有点低落", icon: "😔", defaultNote: "今天有些不开心，希望明天会轻松一点。" }
];

function response(data, delay) {
  return new Promise(resolve => setTimeout(() => resolve({ code: 0, message: "success", data }), delay || 350));
}

function readRecords() {
  if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
    const saved = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(saved) ? saved : DEFAULT_RECORDS.slice();
  }
  return DEFAULT_RECORDS.slice();
}

function saveRecords(records) {
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    wx.setStorageSync(STORAGE_KEY, records);
  }
}

function formatDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getEmotionRecords() {
  return response({ records: readRecords() }, 450);
}

function getEmotionOptions() {
  return response({ options: EMOTION_OPTIONS.map(item => Object.assign({}, item)) }, 150);
}

function getEmotionSummary() {
  const records = readRecords();
  return response({ latest: records.length ? records[0] : null }, 180);
}

function addEmotionRecord(name, noteValue) {
  const option = EMOTION_OPTIONS.find(item => item.name === name);
  if (!option) return Promise.reject(new Error("请选择一种心情"));
  const normalizedNote = typeof noteValue === "string" ? noteValue.trim() : "";
  if (Array.from(normalizedNote).length > 100) return Promise.reject(new Error("心情备注不能超过 100 个字符"));
  const noteCustomized = Boolean(normalizedNote && normalizedNote !== option.defaultNote);
  const note = noteCustomized ? normalizedNote : option.defaultNote;

  const today = formatDate(new Date());
  const record = {
    id: Date.now(),
    date: today,
    name: option.name,
    icon: option.icon,
    note,
    noteCustomized
  };
  // 每天保留一条主动记录，再次选择会更新当天心情。
  const records = [record].concat(readRecords().filter(item => item.date !== today));
  saveRecords(records);
  return response({ record, records }, 350);
}

module.exports = { getEmotionRecords, getEmotionOptions, getEmotionSummary, addEmotionRecord };

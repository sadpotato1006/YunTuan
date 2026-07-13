const STORAGE_KEY = "yuntuan_emotion_records";
const DEFAULT_RECORDS = [
  { id: 1, date: "7月13日", name: "平静", score: 82, note: "和家人通话后，心情安稳。" },
  { id: 2, date: "7月12日", name: "开心", score: 91, note: "散步时遇到了熟悉的邻居。" },
  { id: 3, date: "7月11日", name: "有点想念", score: 68, note: "聊起了家乡和老朋友。" },
  { id: 4, date: "7月10日", name: "舒心", score: 86, note: "午后休息得很好。" }
];
const EMOTION_OPTIONS = [
  { name: "开心", score: 92, icon: "😊", note: "今天心情很好，想把这份快乐记下来。" },
  { name: "平静", score: 82, icon: "🙂", note: "今天心里很安稳，平平淡淡也很好。" },
  { name: "一般", score: 70, icon: "😐", note: "今天心情比较平常，慢慢照顾好自己。" },
  { name: "有点低落", score: 55, icon: "😔", note: "今天有些不开心，希望明天会轻松一点。" }
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

function addEmotionRecord(name) {
  const option = EMOTION_OPTIONS.find(item => item.name === name);
  if (!option) return Promise.reject(new Error("请选择一种心情"));

  const today = formatDate(new Date());
  const record = {
    id: Date.now(),
    date: today,
    name: option.name,
    score: option.score,
    note: option.note
  };
  // 每天保留一条主动记录，再次选择会更新当天心情。
  const records = [record].concat(readRecords().filter(item => item.date !== today));
  saveRecords(records);
  return response({ record, records }, 350);
}

module.exports = { getEmotionRecords, getEmotionOptions, getEmotionSummary, addEmotionRecord };

const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = "emotion_records";
const MAX_RECORDS = 30;
const MAX_NOTE_CHARACTERS = 100;
const EMOTION_OPTIONS = [
  { name: "开心", score: 92, icon: "😊", defaultNote: "今天心情很好，想把这份快乐记下来。" },
  { name: "平静", score: 82, icon: "🙂", defaultNote: "今天心里很安稳，平平淡淡也很好。" },
  { name: "一般", score: 70, icon: "😐", defaultNote: "今天心情比较平常，慢慢照顾好自己。" },
  { name: "有点低落", score: 55, icon: "😔", defaultNote: "今天有些不开心，希望明天会轻松一点。" }
];

exports.main = async event => {
  try {
    const safeEvent = event && typeof event === "object" ? event : {};
    const action = safeEvent.action || "getEmotionRecords";
    const openid = getOpenid();
    const ownerKey = sha256(openid);

    if (action === "getEmotionOptions") {
      return success({ options: EMOTION_OPTIONS.map(item => Object.assign({}, item)) });
    }
    if (action === "getEmotionRecords") {
      return success({ records: await readRecords(ownerKey) });
    }
    if (action === "getEmotionSummary") {
      const records = await readRecords(ownerKey);
      return success({ latest: records.length ? records[0] : null });
    }
    if (action === "addEmotionRecord") {
      return success(await saveTodayRecord(ownerKey, safeEvent.name, safeEvent.note));
    }
    return { code: 400, message: "不支持的情绪记录操作", data: {} };
  } catch (error) {
    if (error && error.publicMessage) {
      return { code: error.code || 400, message: error.publicMessage, data: {} };
    }
    console.error("情绪云函数处理失败：", {
      code: error && (error.errCode || error.code),
      message: error && (error.errMsg || error.message)
    });
    return { code: 500, message: "情绪记录服务暂时不可用，请稍后再试", data: {} };
  }
};

async function readRecords(ownerKey) {
  const response = await db.collection(COLLECTION).where({ ownerKey }).limit(100).get();
  return (response && Array.isArray(response.data) ? response.data : [])
    .sort((first, second) => String(second.dayKey).localeCompare(String(first.dayKey)))
    .slice(0, MAX_RECORDS)
    .map(toPublicRecord);
}

async function saveTodayRecord(ownerKey, name, noteValue) {
  const option = EMOTION_OPTIONS.find(item => item.name === name);
  if (!option) throw publicError(400, "请选择一种心情");
  const customNote = normalizeNote(noteValue);
  const note = customNote || option.defaultNote;

  const now = Date.now();
  const dayKey = getShanghaiDayKey(now);
  const recordId = sha256(`${ownerKey}:${dayKey}`);
  const record = {
    ownerKey,
    dayKey,
    date: formatChineseDate(dayKey),
    name: option.name,
    score: option.score,
    note,
    noteCustomized: Boolean(customNote),
    updatedAt: now
  };
  await db.collection(COLLECTION).doc(recordId).set({ data: record });
  const records = await readRecords(ownerKey);
  return { record: toPublicRecord(Object.assign({ _id: recordId }, record)), records };
}

function normalizeNote(value) {
  const note = typeof value === "string" ? value.trim() : "";
  if (Array.from(note).length > MAX_NOTE_CHARACTERS) {
    throw publicError(400, `心情备注不能超过 ${MAX_NOTE_CHARACTERS} 个字符`);
  }
  return note;
}

function toPublicRecord(record) {
  return {
    id: record._id || sha256(`${record.ownerKey}:${record.dayKey}`),
    date: record.date || formatChineseDate(record.dayKey),
    name: record.name,
    score: record.score,
    note: record.note,
    noteCustomized: record.noteCustomized !== false
  };
}

function getOpenid() {
  const context = cloud.getWXContext();
  const openid = context && typeof context.OPENID === "string" ? context.OPENID.trim() : "";
  if (!openid) throw publicError(401, "无法确认当前微信用户，请重新进入小程序");
  return openid;
}

function getShanghaiDayKey(timestamp) {
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatChineseDate(dayKey) {
  const parts = String(dayKey || "").split("-");
  if (parts.length !== 3) return "";
  return `${Number(parts[1])}月${Number(parts[2])}日`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function success(data) {
  return { code: 0, message: "success", data };
}

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  return error;
}

const STORAGE_KEY = "yuntuan_diagnostics_v1";
const MAX_EVENTS = 160;
const MAX_TEXT_LENGTH = 180;

let events = loadEvents();

function record(category, name, detail, level) {
  const event = {
    at: Date.now(),
    category: cleanLabel(category, "app"),
    name: cleanLabel(name, "event"),
    level: ["info", "warn", "error"].includes(level) ? level : "info",
    detail: sanitizeDetail(detail)
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);
  persist();
  return event;
}

function measure(category, name, startedAt, detail, level) {
  return record(category, name, Object.assign({}, detail || {}, {
    durationMs: Math.max(0, Date.now() - (Number(startedAt) || Date.now()))
  }), level);
}

function getEvents() { return events.slice(); }

function clear() {
  events = [];
  try { wx.removeStorageSync(STORAGE_KEY); } catch (error) {}
}

function buildReport(deviceState) {
  const device = deviceState && typeof deviceState === "object" ? deviceState : {};
  const system = getSystemSummary();
  const lines = [
    "云团真机诊断报告",
    `生成时间：${formatDate(Date.now())}`,
    `小程序环境：${system.environment}`,
    `系统：${system.system}`,
    `微信：${system.wechat}`,
    `设备连接：${device.connected ? "是" : "否"}`,
    `设备类型：${device.simulated ? "模拟挂件" : "真实挂件"}`,
    `协议：${safeText(device.protocolMajor)}.${safeText(device.protocolMinor)}`,
    `固件：${safeText(device.firmwareRevision)}`,
    `硬件：${safeText(device.hardwareRevision)}`,
    `安全模式：${safeText(device.securityMode)}`,
    "",
    `最近事件（${events.length}）：`
  ];
  events.forEach(item => {
    const detail = Object.keys(item.detail || {}).length ? ` ${JSON.stringify(item.detail)}` : "";
    lines.push(`${formatDate(item.at)} [${item.level}] ${item.category}/${item.name}${detail}`);
  });
  lines.push("", "说明：报告不会包含聊天正文、录音内容、联系方式、OpenID、设备序列号或社交 Token。");
  return lines.join("\n");
}

function loadEvents() {
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(stored) ? stored.slice(-MAX_EVENTS) : [];
  } catch (error) { return []; }
}

function persist() {
  try { wx.setStorageSync(STORAGE_KEY, events); } catch (error) {}
}

function sanitizeDetail(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  Object.keys(value).slice(0, 12).forEach(key => {
    if (/openid|token|serial|content|message|audio|base64|file/i.test(key)) return;
    const item = value[key];
    if (typeof item === "number" || typeof item === "boolean") result[key] = item;
    else if (typeof item === "string") result[key] = item.slice(0, MAX_TEXT_LENGTH);
  });
  return result;
}

function cleanLabel(value, fallback) {
  const text = String(value || "").trim().replace(/[^A-Za-z0-9_.:-]/g, "_");
  return text.slice(0, 40) || fallback;
}

function getSystemSummary() {
  try {
    const info = typeof wx.getDeviceInfo === "function" ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    const app = typeof wx.getAppBaseInfo === "function" ? wx.getAppBaseInfo() : info;
    return {
      environment: app && app.environment || "unknown",
      system: `${info.platform || "unknown"} ${info.system || ""}`.trim(),
      wechat: app && app.version || info.version || "unknown"
    };
  } catch (error) {
    return { environment: "unknown", system: "unknown", wechat: "unknown" };
  }
}

function safeText(value) {
  return value === undefined || value === null || value === "" ? "--" : String(value).slice(0, 40);
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

module.exports = { record, measure, getEvents, clear, buildReport };

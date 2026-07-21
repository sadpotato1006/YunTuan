const STORAGE_KEY = "yuntuan_settings";
const DEFAULT_SETTINGS = Object.freeze({
  vibration: true
});

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    // 保留三字节 BLE 设置协议，产品层统一为“社交事件只使用震动反馈”。
    socialReminder: true,
    vibration: source.vibration !== false,
    sound: false
  };
}

function getSettings() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
  return normalizeSettings(wx.getStorageSync(STORAGE_KEY));
}

function saveSettings(value) {
  const settings = normalizeSettings(value);
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    wx.setStorageSync(STORAGE_KEY, settings);
  }
  return settings;
}

function getAlertType(value) {
  const settings = normalizeSettings(value);
  if (settings.vibration) return 0;
  return 3;
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_SETTINGS,
  normalizeSettings,
  getSettings,
  saveSettings,
  getAlertType
};

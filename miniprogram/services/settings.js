const STORAGE_KEY = "yuntuan_settings";
const DEFAULT_SETTINGS = Object.freeze({
  socialReminder: true,
  vibration: true,
  sound: true
});

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    socialReminder: source.socialReminder !== false,
    vibration: source.vibration !== false,
    sound: source.sound !== false
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
  if (settings.vibration && settings.sound) return 2;
  if (settings.sound) return 1;
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

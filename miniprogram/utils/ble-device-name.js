const DEFAULT_DEVICE_NAME = "YT-000001";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isDeviceIdentifier(value, deviceId) {
  const name = clean(value);
  if (!name) return false;
  const id = clean(deviceId);
  if (id && name.toLowerCase() === id.toLowerCase()) return true;

  // Android 通常使用 MAC 地址作为 deviceId，iOS 通常使用 UUID。
  if (/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(name)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name)) return true;
  return /^[0-9a-f]{32}$/i.test(name);
}

function normalizeDeviceName(value, deviceId, fallback) {
  const name = clean(value);
  if (name && !isDeviceIdentifier(name, deviceId)) return name;

  const safeFallback = clean(fallback);
  if (safeFallback && !isDeviceIdentifier(safeFallback, deviceId)) return safeFallback;
  return DEFAULT_DEVICE_NAME;
}

function getAdvertisedDeviceName(device, fallback) {
  const item = device || {};
  const fromName = normalizeDeviceName(item.name, item.deviceId, fallback);
  return normalizeDeviceName(item.localName, item.deviceId, fromName);
}

module.exports = {
  DEFAULT_DEVICE_NAME,
  isDeviceIdentifier,
  normalizeDeviceName,
  getAdvertisedDeviceName
};

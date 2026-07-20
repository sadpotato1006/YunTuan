const bufferUtils = require("../utils/buffer");
const config = require("../config/ble");

function formatTime(date) {
  const pad = value => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function normalizeUuid(uuid) { return String(uuid || "").replace(/-/g, "").toUpperCase(); }
function sameUuid(first, second) { return normalizeUuid(first) === normalizeUuid(second); }
function shortUuid(uuid) { const value = String(uuid || ""); return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value; }

function getStandardValueMeaning(characteristicId, value) {
  const normalized = normalizeUuid(characteristicId);
  const bytes = bufferUtils.toUint8Array(value);
  if ((normalized === "2A19" || normalized.includes("00002A1900001000800000805F9B34FB")) && bytes.length) return `标准电量：${bytes[0]}%`;
  if (["2A24", "2A25", "2A26", "2A27"].some(id => normalized === id || normalized.includes(`0000${id}00001000800000805F9B34FB`))) return bufferUtils.toPrintableText(value);
  return "";
}

function formatCharacteristic(characteristic) {
  const properties = characteristic.properties || {};
  const supported = [];
  if (properties.read) supported.push("Read");
  if (properties.write) supported.push("Write");
  if (properties.writeNoResponse) supported.push("WriteNoResponse");
  if (properties.notify) supported.push("Notify");
  if (properties.indicate) supported.push("Indicate");
  return {
    uuid: characteristic.uuid, displayName: getCharacteristicName(characteristic.uuid),
    propertyText: supported.length ? supported.join(" / ") : "无可用属性", properties,
    canRead: Boolean(properties.read), canWrite: Boolean(properties.write || properties.writeNoResponse),
    canNotify: Boolean(properties.notify || properties.indicate), subscribed: false,
    lastValueHex: "", lastValueText: "", valueMeaning: "", lastUpdatedAt: ""
  };
}

function getServiceName(uuid) {
  const normalized = normalizeUuid(uuid);
  if (normalized === "180F" || normalized.includes("0000180F00001000800000805F9B34FB")) return "Battery Service（电量）";
  if (normalized === "180A" || normalized.includes("0000180A00001000800000805F9B34FB")) return "Device Information（设备信息）";
  if (normalized === "1800" || normalized.includes("0000180000001000800000805F9B34FB")) return "Generic Access";
  if (normalized === "1801" || normalized.includes("0000180100001000800000805F9B34FB")) return "Generic Attribute";
  if (sameUuid(uuid, config.UUIDS.controlService)) return "Yuntuan Control（云团控制）";
  if (sameUuid(uuid, config.UUIDS.audioService)) return "Yuntuan Audio Transfer（挂件语音）";
  if (sameUuid(uuid, config.UUIDS.ttsService)) return "Yuntuan Speech Playback（语音播放）";
  return "自定义/其他服务";
}

function getCharacteristicName(uuid) {
  const normalized = normalizeUuid(uuid);
  const names = { "2A19": "Battery Level（电量）", "2A24": "Model Number（型号）", "2A25": "Serial Number（序列号）", "2A26": "Firmware Revision（固件版本）", "2A27": "Hardware Revision（硬件版本）", "2A00": "Device Name（设备名称）" };
  const custom = [["commandRx", "Command RX（命令写入）"], ["eventTx", "Event TX（响应与事件）"], ["protocolInfo", "Protocol Info（协议信息）"], ["audioControl", "Audio Control（音频流控）"], ["audioData", "Audio Data（音频分片）"], ["audioStatus", "Audio Status（录音状态）"], ["ttsControl", "TTS Control（播放控制）"], ["ttsData", "TTS Data（播放音频分片）"], ["ttsStatus", "TTS Status（播放状态）"]];
  const match = custom.find(item => sameUuid(uuid, config.UUIDS[item[0]]));
  if (match) return match[1];
  const shortId = Object.keys(names).find(id => normalized === id || normalized.includes(`0000${id}00001000800000805F9B34FB`));
  return shortId ? names[shortId] : "自定义/其他特征值";
}

module.exports = { formatTime, normalizeUuid, sameUuid, shortUuid, getStandardValueMeaning, formatCharacteristic, getServiceName, getCharacteristicName };

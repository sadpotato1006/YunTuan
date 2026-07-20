function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(message)); } }, timeoutMs);
    Promise.resolve(promise).then(value => {
      if (settled) return; settled = true; clearTimeout(timer); resolve(value);
    }, error => {
      if (settled) return; settled = true; clearTimeout(timer); reject(error);
    });
  });
}

function getDeviceErrorMessage(code) {
  const messages = { 1: "挂件麦克风初始化失败", 2: "挂件没有检测到有效语音", 3: "挂件录音缓冲区已满", 4: "挂件语音传输超时", 5: "小程序尚未订阅挂件语音" };
  return messages[code] || `挂件语音错误（${code}）`;
}

function writeFile(filePath, data) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath, data, success: resolve,
    fail: error => reject(new Error(error.errMsg || "保存挂件录音失败"))
  }));
}
function removeFile(filePath) {
  if (!filePath || typeof wx === "undefined" || !wx.getFileSystemManager) return;
  wx.getFileSystemManager().unlink({ filePath, fail: () => {} });
}
function sameUuid(first, second) { return String(first || "").replace(/-/g, "").toUpperCase() === String(second || "").replace(/-/g, "").toUpperCase(); }
function findCharacteristic(services, serviceId, characteristicId) {
  const service = (services || []).find(item => sameUuid(item.uuid, serviceId));
  return service ? (service.characteristics || []).find(item => sameUuid(item.uuid, characteristicId)) || null : null;
}
function readUint16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function readInt16(bytes, offset) { const value = readUint16(bytes, offset); return value & 0x8000 ? value - 0x10000 : value; }
function readUint32(bytes, offset) { return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0; }
function writeUint16(bytes, offset, value) { bytes[offset] = value & 0xFF; bytes[offset + 1] = (value >> 8) & 0xFF; }

module.exports = { withTimeout, getDeviceErrorMessage, writeFile, removeFile, findCharacteristic, sameUuid, readUint16, readInt16, readUint32, writeUint16 };

const STORAGE_KEY = "yuntuan_mock_device";
const DEFAULT_DEVICE = {
  id: "YT-001",
  name: "云团陪伴挂件",
  connected: true,
  battery: 78,
  socialMode: true
};
let memoryDevice = Object.assign({}, DEFAULT_DEVICE);

function result(data, delay) {
  return new Promise(resolve => setTimeout(() => resolve({
    code: 0,
    message: "success",
    data
  }), delay || 400));
}

function readDevice() {
  if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
    const saved = wx.getStorageSync(STORAGE_KEY);
    return saved && saved.id ? Object.assign({}, DEFAULT_DEVICE, saved) : Object.assign({}, DEFAULT_DEVICE);
  }
  return Object.assign({}, memoryDevice);
}

function saveDevice(device) {
  memoryDevice = Object.assign({}, device);
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    wx.setStorageSync(STORAGE_KEY, memoryDevice);
  }
  return Object.assign({}, memoryDevice);
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 11) return "早上好，愿您今天心情舒畅";
  if (hour < 18) return "下午好，记得给自己一点休息时间";
  return "晚上好，今天也辛苦啦";
}

function getDevice() { return result({ device: readDevice() }); }
function getHomeOverview() {
  return result({
    greeting: getGreeting(),
    careTip: "记得适量喝水，有空时和家人朋友聊聊天。",
    device: readDevice()
  }, 300);
}
function bindDevice() {
  const device = readDevice();
  device.connected = true;
  return result({ device: saveDevice(device) }, 700);
}
function disconnectDevice() {
  const device = readDevice();
  device.connected = false;
  return result({ device: saveDevice(device) }, 500);
}
function setSocialMode(enabled) {
  const device = readDevice();
  device.socialMode = enabled;
  return result({ device: saveDevice(device) }, 250);
}

module.exports = { getDevice, getHomeOverview, bindDevice, disconnectDevice, setSocialMode };

const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/device");

function invoke(action, mockFn, httpOptions, data) {
  if (config.backendMode === "mock") return mockFn();
  if (config.backendMode === "cloud") return callCloudFunction("device", Object.assign({ action }, data || {}));
  return request(httpOptions);
}

function getDevice() { return invoke("getDevice", mock.getDevice, { url: "/device" }); }
function getHomeOverview() { return invoke("getHomeOverview", mock.getHomeOverview, { url: "/home/overview" }); }
function bindDevice() {
  // BLE 搜索和连接仍应在小程序端实现；云函数只保存绑定关系等服务端数据。
  return invoke("bindDevice", mock.bindDevice, { url: "/device/bind", method: "POST" });
}
function disconnectDevice() {
  // 后续可在小程序端调用 wx.closeBLEConnection，再同步服务端记录。
  return invoke("disconnectDevice", mock.disconnectDevice, { url: "/device/disconnect", method: "POST" });
}
function setSocialMode(enabled) {
  return invoke(
    "setSocialMode",
    () => mock.setSocialMode(enabled),
    { url: "/device/social-mode", method: "PUT", data: { enabled } },
    { enabled }
  );
}

module.exports = { getDevice, getHomeOverview, bindDevice, disconnectDevice, setSocialMode };

const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/device");
const bleDevice = require("./yuntuan-device");

function invoke(action, mockFn, bleFn, httpOptions, data) {
  const mode = config.getBackendMode("device");
  if (mode === "mock") return mockFn();
  if (mode === "ble") return bleFn();
  if (mode === "cloud") return callCloudFunction("device", Object.assign({ action }, data || {}));
  if (mode === "http") return request(httpOptions);
  return Promise.reject(new Error(`未知的设备后端模式：${mode}`));
}

function getDevice() {
  return invoke("getDevice", mock.getDevice, bleDevice.getDevice, { url: "/device" });
}
function getHomeOverview() {
  return invoke("getHomeOverview", mock.getHomeOverview, bleDevice.getHomeOverview, { url: "/home/overview" });
}
function bindDevice(deviceId) {
  return invoke(
    "bindDevice",
    mock.bindDevice,
    () => bleDevice.connectDevice(deviceId),
    { url: "/device/bind", method: "POST", data: { deviceId } },
    { deviceId }
  );
}
function disconnectDevice() {
  return invoke(
    "disconnectDevice",
    mock.disconnectDevice,
    bleDevice.disconnectDevice,
    { url: "/device/disconnect", method: "POST" }
  );
}
function setSocialMode(enabled) {
  return invoke(
    "setSocialMode",
    () => mock.setSocialMode(enabled),
    () => bleDevice.setSocialMode(enabled),
    { url: "/device/social-mode", method: "PUT", data: { enabled } },
    { enabled }
  );
}
function setAlertSettings(settings) {
  return invoke(
    "setAlertSettings",
    () => Promise.resolve({ code: 0, message: "success", data: { settings } }),
    () => bleDevice.setAlertSettings(settings),
    { url: "/device/alert-settings", method: "PUT", data: settings },
    { settings }
  );
}

function initialize() { return bleDevice.initialize(); }
function startScan() { return bleDevice.startScan(); }
function stopScan() { return bleDevice.stopScan(); }
function loadSimulator() { return bleDevice.loadSimulator(); }
function simulateSocialEncounter(peerToken, rssi) {
  return bleDevice.simulateSocialEncounter(peerToken, rssi);
}
function reconnectLastDevice() { return bleDevice.reconnectLastDevice(false); }
function findDevice() { return bleDevice.findDevice(undefined, 1800); }
function ping() { return bleDevice.ping(); }
function refreshStatus() { return bleDevice.getStatus(); }
function refreshSocialRegistration() { return bleDevice.refreshSocialRegistration(false); }
function retryLastEncounterProfile() { return bleDevice.retryLastEncounterProfile(); }
function retryEncounterProfile(encounterId) { return bleDevice.retryEncounterProfile(encounterId); }
function getEncounterRecords() { return bleDevice.getEncounterRecords(); }
function clearLocalPrivateState() { return bleDevice.clearLocalPrivateState(); }
function subscribe(listener) { return bleDevice.subscribe(listener); }

module.exports = {
  getDevice,
  getHomeOverview,
  bindDevice,
  disconnectDevice,
  setSocialMode,
  setAlertSettings,
  initialize,
  startScan,
  stopScan,
  loadSimulator,
  simulateSocialEncounter,
  reconnectLastDevice,
  findDevice,
  ping,
  refreshStatus,
  refreshSocialRegistration,
  retryLastEncounterProfile,
  retryEncounterProfile,
  getEncounterRecords,
  clearLocalPrivateState,
  subscribe
};

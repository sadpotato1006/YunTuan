const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

async function testBleAttemptCancellation() {
  let pendingConnect = null;
  let pendingCharacteristics = null;
  let serviceReads = 0;
  let characteristicReads = 0;
  let closeCalls = 0;
  global.wx = {
    getStorageSync() { return null; },
    setStorageSync() {},
    openBluetoothAdapter(options) { options.success({}); },
    getBluetoothAdapterState(options) { options.success({ available: true, discovering: false }); },
    createBLEConnection(options) {
      if (options.deviceId === "device-1") pendingConnect = options;
      else options.success({});
    },
    closeBLEConnection(options) { closeCalls += 1; options.success({}); },
    getBLEDeviceServices(options) {
      serviceReads += 1;
      options.success({ services: options.deviceId === "device-2" ? [{ uuid: "service-1", isPrimary: true }] : [] });
    },
    getBLEDeviceCharacteristics(options) {
      characteristicReads += 1;
      pendingCharacteristics = options;
    },
    onBluetoothDeviceFound() {}, offBluetoothDeviceFound() {},
    onBLEConnectionStateChange() {}, offBLEConnectionStateChange() {},
    onBluetoothAdapterStateChange() {}, offBluetoothAdapterStateChange() {},
    onBLECharacteristicValueChange() {}, offBLECharacteristicValueChange() {}
  };

  const bleService = require("../miniprogram/services/ble");
  const observedConnect = bleService.connectDevice("device-1", "云团挂件")
    .then(() => ({ resolved: true }), error => ({ resolved: false, error }));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pendingConnect, "应已发起微信 BLE 连接");

  await bleService.disconnectDevice();
  pendingConnect.success({});
  const outcome = await observedConnect;
  assert.strictEqual(outcome.resolved, false, "取消后的旧连接不能继续完成");
  assert.strictEqual(outcome.error.cancelled, true);
  assert.strictEqual(serviceReads, 0, "取消后不能继续读取 GATT 服务");
  assert.strictEqual(closeCalls, 2, "Android 迟到的连接成功后应执行第二次兜底关闭");
  assert.strictEqual(bleService.getState().connecting, false);

  const gattConnect = bleService.connectDevice("device-2", "云团挂件")
    .then(() => ({ resolved: true }), error => ({ resolved: false, error }));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(pendingCharacteristics, "应已进入 GATT 特征读取阶段");
  await bleService.disconnectDevice();
  pendingCharacteristics.success({ characteristics: [] });
  const gattOutcome = await gattConnect;
  assert.strictEqual(gattOutcome.resolved, false, "GATT 读取阶段取消后不能继续标记连接成功");
  assert.strictEqual(gattOutcome.error.cancelled, true);
  assert.strictEqual(characteristicReads, 1);
  assert.strictEqual(closeCalls, 4, "GATT 阶段迟到回调也应执行兜底关闭");
  assert.strictEqual(bleService.getState().connected, false);
}

async function testDevicePageToggle() {
  let pageDefinition = null;
  let cancelCalls = 0;
  let reconnectCalls = 0;
  const deviceService = {
    subscribe() { return function unsubscribe() {}; },
    cancelReconnectLastDevice() {
      cancelCalls += 1;
      return Promise.resolve({ data: { device: { reconnecting: false, canReconnect: true } } });
    },
    reconnectLastDevice() {
      reconnectCalls += 1;
      return Promise.resolve({ data: { device: { ready: true } } });
    }
  };
  const context = {
    Page(definition) { pageDefinition = definition; },
    wx: { showToast() {}, stopPullDownRefresh() {} },
    console,
    require(request) {
      if (request === "../../services/device") return deviceService;
      if (request === "../../services/social-profile") {
        return { getProfile() { return {}; }, toPublicCard() { return {}; } };
      }
      if (request === "../../services/settings") return { getSettings() { return {}; } };
      if (request === "../../services/data-privacy") return {};
      if (request === "../../utils/tab-swipe") return { enter() {} };
      throw new Error(`unexpected require: ${request}`);
    }
  };
  vm.runInNewContext(source("miniprogram/pages/device/device.js"), context);
  assert.ok(pageDefinition);
  const page = Object.assign({}, pageDefinition, {
    data: { device: { reconnecting: true }, operating: true },
    setData(patch) { this.data = Object.assign({}, this.data, patch); },
    showError(error) { throw error; }
  });
  await page.reconnectLastDevice();
  assert.strictEqual(cancelCalls, 1, "重连中再次点击应调用取消");
  assert.strictEqual(reconnectCalls, 0, "重连中再次点击不能再启动新连接");
  assert.strictEqual(page.data.operating, false);
}

async function main() {
  const wxml = source("miniprogram/pages/device/device.wxml");
  const deviceSource = source("miniprogram/services/yuntuan-device.js");
  assert.match(wxml, /device\.reconnecting \? '停止重新连接'/);
  assert.match(wxml, /operating && !device\.reconnecting/);
  assert.match(deviceSource, /function cancelReconnectLastDevice/);
  assert.match(deviceSource, /bleService\.disconnectDevice\(\)\.catch/);
  assert.match(deviceSource, /generation !== reconnectGeneration/);
  assert.match(deviceSource, /operationGeneration !== connectionOperationGeneration/);
  await testBleAttemptCancellation();
  await testDevicePageToggle();
  console.log("reconnect cancel tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

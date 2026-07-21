const assert = require("assert");

const config = require("../miniprogram/config/ble");
const {
  DEFAULT_DEVICE_NAME,
  isDeviceIdentifier,
  normalizeDeviceName,
  getAdvertisedDeviceName
} = require("../miniprogram/utils/ble-device-name");

assert.strictEqual(config.defaultDeviceName, DEFAULT_DEVICE_NAME);
assert.strictEqual(isDeviceIdentifier("28:84:85:9E:FE:01"), true);
assert.strictEqual(isDeviceIdentifier("28-84-85-9E-FE-01"), true);
assert.strictEqual(isDeviceIdentifier("YT-000001"), false);
assert.strictEqual(
  normalizeDeviceName("28:84:85:9E:FE:01", "28:84:85:9E:FE:01", config.defaultDeviceName),
  "YT-000001"
);
assert.strictEqual(
  normalizeDeviceName("Peripheral A", "ios-generated-device-id", config.defaultDeviceName),
  "Peripheral A"
);
assert.strictEqual(
  getAdvertisedDeviceName({
    deviceId: "28:84:85:9E:FE:01",
    name: "28:84:85:9E:FE:01",
    localName: "YT-000001"
  }),
  "YT-000001"
);

console.log("BLE device name tests passed");

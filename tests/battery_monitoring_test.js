const assert = require("assert");
const fs = require("fs");
const path = require("path");
const protocol = require("../miniprogram/utils/yuntuan-protocol");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const firmware = source("hard/main.cpp");
assert.match(firmware, /#define FIRMWARE_REVISION\s+"0\.8\.0"/);
assert.match(firmware, /#define PIN_BATTERY_ADC\s+1\b/);
assert.match(firmware, /#define PIN_TP4056_CHRG\s+9\b/);
assert.match(firmware, /#define PIN_TP4056_STDBY\s+10\b/);
assert.match(firmware, /analogSetPinAttenuation\(PIN_BATTERY_ADC, ADC_11db\)/);
assert.match(firmware, /analogReadMilliVolts\(PIN_BATTERY_ADC\)/);
assert.match(firmware, /#define BATTERY_SAMPLE_COUNT\s+15\b/);
assert.match(firmware, /batteryPercentFromMillivolts/);
assert.match(firmware, /pollChargingState\(now\)/);
assert.match(firmware, /g_chargingState == 1 \|\| activityOn/);
assert.doesNotMatch(firmware, /g_batteryLevel--/);

const status = protocol.parseStatusData(new Uint8Array([76, 1, 1, 0x78, 0x56, 0x34, 0x12]));
assert.deepStrictEqual(status, {
  battery: 76,
  chargingState: 1,
  socialMode: true,
  uptime: 0x12345678
});

const deviceWxml = source("miniprogram/pages/device/device.wxml");
const homeWxml = source("miniprogram/pages/home/home.wxml");
const labWxml = source("miniprogram/pages/device-lab/device-lab.wxml");
[deviceWxml, homeWxml, labWxml].forEach(markup => {
  assert.match(markup, /充电中/);
  assert.match(markup, /已充满/);
});

const deviceService = source("miniprogram/services/yuntuan-device.js");
assert.match(deviceService, /chargingState: event\.chargingState/);

console.log("battery monitoring tests passed");

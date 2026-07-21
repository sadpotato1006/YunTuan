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
assert.match(firmware, /analogSetPinAttenuation\(PIN_BATTERY_ADC, ADC_11db\)/);
assert.match(firmware, /analogReadMilliVolts\(PIN_BATTERY_ADC\)/);
assert.match(firmware, /#define BATTERY_SAMPLE_COUNT\s+15\b/);
assert.match(firmware, /#define BATTERY_SETTLING_SAMPLE_COUNT\s+3\b/);
assert.match(firmware, /i < BATTERY_SETTLING_SAMPLE_COUNT/);
assert.match(firmware, /#define BATTERY_REQUIRED_VALID_SAMPLES\s+3\b/);
assert.match(firmware, /#define BATTERY_REQUIRED_INVALID_SAMPLES\s+3\b/);
assert.match(firmware, /#define BATTERY_PERCENT_HYSTERESIS\s+2\b/);
assert.match(firmware, /#define BATTERY_RETRY_INTERVAL_MS\s+1000UL/);
assert.match(firmware, /g_batteryValid\s*=\s*false/);
assert.match(firmware, /g_batteryValid \? g_batteryLevel : 0xFF/);
assert.match(firmware, /Battery ADC invalid %u\/%u/);
assert.match(firmware, /waiting for valid ADC samples/);
assert.match(firmware, /batteryPercentFromMillivolts/);
assert.match(firmware, /#define CAPABILITIES\s+0x0F2F\b/);
assert.doesNotMatch(firmware, /PIN_TP4056_CHRG|PIN_TP4056_STDBY|pollChargingState|readChargingState/);
assert.doesNotMatch(firmware, /g_batteryLevel--/);
assert.doesNotMatch(firmware, /g_batteryLevel\s*=\s*100/);

const status = protocol.parseStatusData(new Uint8Array([76, 0xFF, 1, 0x78, 0x56, 0x34, 0x12]));
assert.deepStrictEqual(status, {
  battery: 76,
  chargingState: 255,
  socialMode: true,
  uptime: 0x12345678
});
assert.deepStrictEqual(
  protocol.parseStatusData(new Uint8Array([0xFF, 0xFF, 0, 0, 0, 0, 0])),
  { battery: null, chargingState: 255, socialMode: false, uptime: 0 }
);

const deviceWxml = source("miniprogram/pages/device/device.wxml");
const labWxml = source("miniprogram/pages/device-lab/device-lab.wxml");
[deviceWxml, labWxml].forEach(markup => {
  assert.doesNotMatch(markup, /充电中|已充满/);
  assert.match(markup, /电量/);
});
assert.match(deviceWxml, /约 \{\{device\.battery\}\}%/);
assert.match(deviceWxml, /电量读取中/);
assert.match(deviceWxml, /电量暂不可用/);

const deviceService = source("miniprogram/services/yuntuan-device.js");
assert.doesNotMatch(deviceService, /chargingState/);
assert.doesNotMatch(deviceService, /patch\.battery\s*=/);
assert.match(deviceService, /BATTERY_READING_TIMEOUT_MS = 6000/);
assert.match(deviceService, /batteryStatus: "reading"/);
assert.match(deviceService, /batteryStatus: "unavailable"/);

console.log("battery monitoring tests passed");

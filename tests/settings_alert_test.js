const assert = require("assert");
const fs = require("fs");
const path = require("path");
const config = require("../miniprogram/config/ble");
const protocol = require("../miniprogram/utils/yuntuan-protocol");
const settingsService = require("../miniprogram/services/settings");
const mockBle = require("../miniprogram/mock/ble");

assert.deepStrictEqual(settingsService.normalizeSettings({}), {
  socialReminder: true,
  vibration: true,
  sound: true
});
assert.strictEqual(settingsService.getAlertType({ vibration: true, sound: true }), 2);
assert.strictEqual(settingsService.getAlertType({ vibration: false, sound: true }), 1);
assert.strictEqual(settingsService.getAlertType({ vibration: true, sound: false }), 0);
assert.strictEqual(settingsService.getAlertType({ vibration: false, sound: false }), 3);

const alertPayload = protocol.buildAlertSettingsPayload({
  socialReminder: false,
  vibration: true,
  sound: false
});
assert.deepStrictEqual(Array.from(alertPayload), [0, 1, 0]);
assert.deepStrictEqual(protocol.parseAlertSettingsData(alertPayload), {
  socialReminder: false,
  vibration: true,
  sound: false
});

const request = protocol.createRequest(config.COMMANDS.SET_ALERT_SETTINGS, 7, alertPayload);
const response = protocol.assertSuccessfulResponse(mockBle.createWriteResponse(request).value);
assert.deepStrictEqual(protocol.parseAlertSettingsData(response.data), {
  socialReminder: false,
  vibration: true,
  sound: false
});

const deviceWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "device", "device.wxml"),
  "utf8"
);
assert.match(deviceWxml, /data-key="socialReminder"/);
assert.match(deviceWxml, /data-key="vibration"/);
assert.match(deviceWxml, /data-key="sound"/);
assert.match(deviceWxml, /wx:if="\{\{device\.ready\}\}"/);
assert.match(deviceWxml, /disabled="\{\{settingSaving\}\}"/);
const deviceJs = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "device", "device.js"),
  "utf8"
);
assert.match(deviceJs, /deviceService\.setAlertSettings\(next\)/);
assert.match(deviceJs, /settingsService\.saveSettings/);

const settingsWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "settings", "settings.wxml"),
  "utf8"
);
assert.doesNotMatch(settingsWxml, /data-key="socialReminder"/);

const firmware = fs.readFileSync(path.join(__dirname, "..", "hard", "main.cpp"), "utf8");
assert.match(firmware, /handleSetAlertSettings/);
assert.match(firmware, /!g_socialReminderEnabled/);
assert.match(firmware, /g_vibrationEnabled/);
assert.match(firmware, /g_soundEnabled/);

console.log("settings alert tests passed");

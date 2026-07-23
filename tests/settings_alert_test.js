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
  sound: false
});
assert.strictEqual(settingsService.getAlertType({ vibration: true, sound: true }), 0);
assert.strictEqual(settingsService.getAlertType({ vibration: false, sound: true }), 3);
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
  socialReminder: true,
  vibration: true,
  sound: false
});

const moreWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "more", "more.wxml"),
  "utf8"
);
assert.match(moreWxml, /data-key="vibration"/);
assert.doesNotMatch(moreWxml, /data-key="socialReminder"/);
assert.doesNotMatch(moreWxml, /data-key="sound"/);
assert.match(moreWxml, /硬件设置/);
assert.match(moreWxml, /震动反馈/);
assert.match(moreWxml, /!device\.ready \|\| settingSaving/);
const moreJs = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "more", "more.js"),
  "utf8"
);
assert.match(moreJs, /deviceService\.setAlertSettings\(next\)/);
assert.match(moreJs, /settingsService\.saveSettings/);

assert.match(moreWxml, /隐私与数据/);
assert.match(moreWxml, /wx:if="\{\{showPrivateTools\}\}"/);

const firmware = fs.readFileSync(path.join(__dirname, "..", "hard", "main.cpp"), "utf8");
assert.match(firmware, /handleSetAlertSettings/);
assert.match(firmware, /g_vibrationEnabled/);
assert.doesNotMatch(firmware, /g_socialReminderEnabled/);
assert.doesNotMatch(firmware, /g_soundEnabled/);
assert.match(firmware, /startFindDeviceAlert\(0, SOCIAL_ALERT_DURATION_MS\)/);

console.log("settings alert tests passed");

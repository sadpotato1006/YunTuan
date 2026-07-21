const assert = require("assert");
const fs = require("fs");
const path = require("path");
const config = require("../miniprogram/config/ble");
const protocol = require("../miniprogram/utils/yuntuan-protocol");

const payload = protocol.buildFindDevicePayload(2, 1800);
assert.deepStrictEqual(Array.from(payload), [2, 0x08, 0x07]);
assert.deepStrictEqual(Array.from(protocol.buildFindDevicePayload(3, 1800)), [3, 0x08, 0x07]);
assert.strictEqual(
  protocol.hasCapability(config.capabilities.findDevice, config.capabilities.findDevice),
  true
);
assert.throws(() => protocol.buildFindDevicePayload(4, 1800), /AlertType/);
assert.throws(() => protocol.buildFindDevicePayload(2, 499), /500/);
assert.throws(() => protocol.buildFindDevicePayload(2, 10001), /10000/);

const deviceService = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "services", "yuntuan-device.js"),
  "utf8"
);
const firmware = fs.readFileSync(path.join(__dirname, "..", "hard", "main.cpp"), "utf8");
assert.match(deviceService, /alertType === undefined \? 2 : alertType/);
assert.match(deviceService, /震动、播放提示音并闪灯/);
assert.match(firmware, /sineTable\[32\]/);
assert.match(firmware, /frequencyHz = 784/);
assert.match(firmware, /frequencyHz = 659/);
assert.doesNotMatch(firmware, /880 Hz 方波提示音/);

console.log("find device tests passed");

const assert = require("assert");
const config = require("../miniprogram/config/ble");
const protocol = require("../miniprogram/utils/yuntuan-protocol");

const payload = protocol.buildFindDevicePayload(2, 1800);
assert.deepStrictEqual(Array.from(payload), [2, 0x08, 0x07]);
assert.strictEqual(
  protocol.hasCapability(config.capabilities.findDevice, config.capabilities.findDevice),
  true
);
assert.throws(() => protocol.buildFindDevicePayload(3, 1800), /AlertType/);
assert.throws(() => protocol.buildFindDevicePayload(2, 499), /500/);
assert.throws(() => protocol.buildFindDevicePayload(2, 10001), /10000/);

console.log("find device tests passed");

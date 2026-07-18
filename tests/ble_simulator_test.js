const assert = require("assert");
const fs = require("fs");
const path = require("path");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); }
};

const config = require("../miniprogram/config/ble");
const protocol = require("../miniprogram/utils/yuntuan-protocol");
const simulator = require("../miniprogram/mock/ble");

const token = simulator.getSocialToken();
assert.ok(Number.isInteger(token) && token > 0 && token <= 0xFFFFFFFF);
assert.strictEqual(simulator.getSocialToken(), token, "同一小程序实例应保持稳定模拟 Token");
assert.strictEqual(storage.get("yuntuan_simulator_social_token"), token);

const info = protocol.parseProtocolInfo(simulator.readValue(config.UUIDS.protocolInfo));
assert.strictEqual(info.protocolMajor, config.protocolMajor);
assert.strictEqual(info.protocolMinor, config.protocolMinor);
assert.ok(protocol.hasCapability(info.capabilities, config.capabilities.socialEncounter));
assert.ok(protocol.hasCapability(info.capabilities, config.capabilities.alertSettings));
assert.ok(!protocol.hasCapability(info.capabilities, config.capabilities.audioUpload));
assert.ok(!protocol.hasCapability(info.capabilities, config.capabilities.audioPlayback));

const tokenRequest = protocol.createRequest(config.COMMANDS.GET_SOCIAL_TOKEN, 7, new Uint8Array(0));
const tokenResponse = protocol.assertSuccessfulResponse(simulator.createWriteResponse(tokenRequest).value);
assert.strictEqual(protocol.readUint32LE(tokenResponse.data, 0), token);

const peerToken = token === 0x12345678 ? 0x23456789 : 0x12345678;
const encounter = protocol.parseEvent(simulator.createSocialEncounterValue(peerToken, -55));
assert.strictEqual(encounter.type, "socialEncounter");
assert.strictEqual(encounter.peerToken, peerToken);
assert.strictEqual(encounter.rssi, -55);
assert.strictEqual(encounter.timestampValid, true);
assert.match(encounter.encounterId, /^[a-fA-F0-9]{16}$/);
assert.throws(() => simulator.createSocialEncounterValue(token, -55), /自己/);

const bleSource = fs.readFileSync(path.join(__dirname, "..", "miniprogram/services/ble.js"), "utf8");
const deviceSource = fs.readFileSync(path.join(__dirname, "..", "miniprogram/services/yuntuan-device.js"), "utf8");
const pageSource = fs.readFileSync(path.join(__dirname, "..", "miniprogram/pages/device-lab/device-lab.wxml"), "utf8");
assert.match(bleSource, /emitSimulatorSocialEncounter/);
assert.match(bleSource, /handleValueChange\(\{/);
assert.match(deviceSource, /simulateSocialEncounter/);
assert.match(deviceSource, /state\.socialMode/);
assert.match(pageSource, /本机模拟 Token/);
assert.match(pageSource, /输入对方 Token/);
assert.match(pageSource, /创建测试伙伴并模拟相遇/);

delete global.wx;
console.log("ble simulator tests passed");

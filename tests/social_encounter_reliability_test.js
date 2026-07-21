const assert = require("assert");
const fs = require("fs");
const path = require("path");

let storage = {};
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = JSON.parse(JSON.stringify(value)); }
};

const encounters = require("../miniprogram/services/social-encounters");

const deviceSource = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "services", "yuntuan-device.js"),
  "utf8"
);
const processStart = deviceSource.indexOf("function processSocialEncounter");
const saveIndex = deviceSource.indexOf("encounterStore.saveEncounter(event)", processStart);
const ackIndex = deviceSource.indexOf("enqueueSocialEncounterAck", processStart);
assert.ok(saveIndex > processStart && ackIndex > saveIndex, "小程序必须先本地落盘再 ACK");
assert.match(deviceSource, /config\.COMMANDS\.ACK_SOCIAL_ENCOUNTER/);
assert.match(deviceSource, /pendingSocialAcks/);
const processEnd = deviceSource.indexOf("function notifyNewSocialEncounter", processStart);
const processSource = deviceSource.slice(processStart, processEnd);
assert.doesNotMatch(processSource, /vibrateShort|showToast/, "身份确认前不应立即提醒相遇");
assert.match(deviceSource, /resolution\.alreadyKnown\s*!==\s*true/);
assert.match(deviceSource, /resolveEncounterProfile\([^\n]+!saved\.duplicate\)/);

const first = encounters.saveEncounter({
  encounterId: "0102030405060708",
  peerToken: 0x12345678,
  rssi: -65,
  occurredAt: 1700000000,
  timestampValid: true
});
assert.strictEqual(first.duplicate, false);
assert.strictEqual(first.record.occurredAt, 1700000000 * 1000);
assert.strictEqual(first.record.timeEstimated, false);

const duplicate = encounters.saveEncounter({
  encounterId: "0102030405060708",
  peerToken: 0x12345678,
  rssi: -60,
  occurredAt: 1700000100,
  timestampValid: true
});
assert.strictEqual(duplicate.duplicate, true);
assert.strictEqual(encounters.getDisplayRecords().length, 1);

const display = encounters.getDisplayRecords()[0];
assert.ok(!("peerToken" in display));
assert.strictEqual(display.encounterId, "0102030405060708");

const failed = encounters.markFailed(first.record.encounterId, "网络暂时不可用");
assert.strictEqual(failed.status, "failed");
assert.strictEqual(failed.peerToken, 0x12345678, "查询失败后保留匿名令牌用于重试");

const resolved = encounters.markResolved(first.record.encounterId, {
  peerKey: "b".repeat(64),
  alreadyKnown: false,
  interactionRef: "a".repeat(48),
  profile: {
    avatarType: "virtual",
    avatarValue: "🐳",
    avatarColor: "#DDECF5",
    nickname: "小团",
    bio: "想认识一起跑步的朋友",
    tags: ["跑步", "摄影"],
    intention: "buddy",
    openid: "must-not-leak",
    deviceId: "must-not-leak"
  }
});
assert.strictEqual(resolved.status, "resolved");
assert.strictEqual(resolved.peerToken, 0, "解析成功后删除本地匿名令牌");
assert.strictEqual(resolved.profile.nickname, "小团");
assert.strictEqual(resolved.peerKey, "b".repeat(64));
assert.strictEqual(resolved.alreadyKnown, false);
assert.strictEqual(resolved.interactionRef, "a".repeat(48));
assert.ok(!JSON.stringify(resolved.profile).includes("must-not-leak"));
assert.strictEqual(encounters.markGreeting(first.record.encounterId, "sent").greetingStatus, "sent");

const metAgain = encounters.saveEncounter({
  encounterId: "090A0B0C0D0E0F10",
  peerToken: 0x22334455,
  rssi: -52,
  occurredAt: 1700000200,
  timestampValid: true
});
encounters.markResolved(metAgain.record.encounterId, {
  peerKey: "b".repeat(64),
  alreadyKnown: true,
  interactionRef: "c".repeat(48),
  profile: resolved.profile
});
const grouped = encounters.getDisplayRecords();
assert.strictEqual(grouped.length, 1, "同一个伙伴的多次相遇应合并显示");
assert.strictEqual(grouped[0].encounterCount, 2);
assert.strictEqual(grouped[0].alreadyKnown, true);
assert.strictEqual(grouped[0].greetingStatus, "matched");
assert.strictEqual(grouped[0].interactionRef, "", "已认识伙伴不应继续保留招呼入口");

encounters.clearRecords();
["3132333435363738", "4142434445464748"].forEach((encounterId, index) => {
  const legacy = encounters.saveEncounter({
    encounterId,
    peerToken: 0x33445566 + index,
    rssi: -58 - index,
    timestampValid: false
  });
  encounters.markResolved(legacy.record.encounterId, {
    interactionRef: String(index + 1).repeat(48),
    profile: resolved.profile
  });
});
const groupedLegacy = encounters.getDisplayRecords();
assert.strictEqual(groupedLegacy.length, 1, "升级前的重复名片也应兼容合并");
assert.strictEqual(groupedLegacy[0].encounterCount, 2);
encounters.clearRecords();

const estimated = encounters.saveEncounter({
  encounterId: "1112131415161718",
  peerToken: 0x87654321,
  rssi: -70,
  occurredAt: 0,
  timestampValid: false
});
assert.strictEqual(estimated.record.timeEstimated, true);
assert.ok(estimated.record.occurredAt > 0);

storage[encounters.STORAGE_KEY].records.unshift({
  encounterId: "2122232425262728",
  peerToken: 0x11223344,
  rssi: -68,
  occurredAt: Date.now() - encounters.PEER_TOKEN_RETENTION_MS - 1000,
  receivedAt: Date.now() - encounters.PEER_TOKEN_RETENTION_MS - 1000,
  status: "failed"
});
const expired = encounters.getRecord("2122232425262728");
assert.strictEqual(expired.peerToken, 0);
assert.strictEqual(expired.status, "unavailable");
assert.strictEqual(expired.errorMessage, "相遇名片查询期限已过");

for (let index = 0; index < 35; index += 1) {
  encounters.saveEncounter({
    encounterId: index.toString(16).padStart(16, "0"),
    peerToken: index + 1,
    rssi: -60,
    timestampValid: false
  });
}
assert.strictEqual(encounters.getDisplayRecords().length, encounters.MAX_RECORDS);
encounters.clearRecords();
assert.strictEqual(encounters.getDisplayRecords().length, 0);

const previousSetStorage = global.wx.setStorageSync;
global.wx.setStorageSync = function failStorage() { throw new Error("storage full"); };
assert.throws(() => encounters.saveEncounter({
  encounterId: "FFFFFFFFFFFFFFFF",
  peerToken: 1,
  rssi: -60
}), /storage full/);
global.wx.setStorageSync = previousSetStorage;

console.log("social encounter reliability tests passed");

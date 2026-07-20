const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  getDeviceInfo: () => ({ platform: "android", system: "Android 15" }),
  getAppBaseInfo: () => ({ environment: "wxwork", version: "9.0.0" })
};
const diagnostics = require("../miniprogram/services/diagnostics");
diagnostics.clear();
diagnostics.record("voice", "phase", { from: "recording", to: "receiving", openid: "secret", content: "private" });
diagnostics.measure("cloud", "chat.transcribe", Date.now() - 120, { ok: true });
const events = diagnostics.getEvents();
assert.strictEqual(events.length, 2);
assert.ok(!JSON.stringify(events).includes("secret"));
assert.ok(!JSON.stringify(events).includes("private"));
const report = diagnostics.buildReport({ connected: true, protocolMajor: 1, protocolMinor: 7, serialNumber: "hidden" });
assert.ok(report.includes("云团真机诊断报告"));
assert.ok(report.includes("voice/phase"));
assert.ok(!report.includes("hidden"));
diagnostics.clear();
assert.strictEqual(diagnostics.getEvents().length, 0);
delete global.wx;
console.log("diagnostics tests passed");

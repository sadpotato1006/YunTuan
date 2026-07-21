const assert = require("assert");
const fs = require("fs");
const path = require("path");

const originalWx = global.wx;
const indexPath = require.resolve("../miniprogram/config/index");
const profilesPath = require.resolve("../miniprogram/config/profiles");

try {
  global.wx = {
    getAccountInfoSync() {
      return { miniProgram: { envVersion: "trial" } };
    }
  };
  delete require.cache[indexPath];
  delete require.cache[profilesPath];
  const config = require(indexPath);
  assert.strictEqual(config.environmentVersion, "trial");
  assert.strictEqual(config.getBackendMode("device"), "ble");
  assert.strictEqual(config.cloudEnvId, "cloudbase-d7g2y0azb4f5dcf00");

  const profileSource = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "config", "profiles.js"),
    "utf8"
  );
  assert.ok(profileSource.includes('cloudEnvId: "cloudbase-d7g2y0azb4f5dcf00"'));
  console.log("config profile tests passed");
} finally {
  global.wx = originalWx;
  delete require.cache[indexPath];
  delete require.cache[profilesPath];
}

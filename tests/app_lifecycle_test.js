const assert = require("assert");

const config = require("../miniprogram/config/index");
config.backendMode = "cloud";
config.serviceBackendModes = { chat: "cloud", device: "ble", emotion: "cloud" };

const originalApp = global.App;
const originalWx = global.wx;
const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
const timers = new Set();
let appDefinition = null;
let cloudInitOptions = null;

global.wx = {
  cloud: { init(options) { cloudInitOptions = options; } },
  showTabBarRedDot() {},
  hideTabBarRedDot() {}
};
global.App = definition => { appDefinition = definition; };
global.setTimeout = callback => {
  const timer = { callback };
  timers.add(timer);
  return timer;
};
global.clearTimeout = timer => { timers.delete(timer); };

try {
  require("../miniprogram/app");
  assert.ok(appDefinition);
  appDefinition.onLaunch();
  assert.strictEqual(cloudInitOptions.env, "cloudbase-d7g2y0azb4f5dcf00");
  appDefinition.onShow();
  assert.strictEqual(appDefinition._socialBadgePollingActive, true);
  assert.ok(appDefinition._socialBadgeTimer);
  assert.strictEqual(timers.has(appDefinition._socialBadgeTimer), true);

  appDefinition.onHide();
  assert.strictEqual(appDefinition._socialBadgePollingActive, false);
  assert.strictEqual(appDefinition._socialBadgeTimer, null);
  assert.strictEqual(timers.size, 0);
  console.log("app lifecycle tests passed");
} finally {
  global.App = originalApp;
  global.wx = originalWx;
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
}

const assert = require("assert");

const originalSetTimeout = global.setTimeout;
global.setTimeout = callback => { callback(); return 0; };

let switchedTo = "";
const app = { globalData: {} };
global.getApp = () => app;
global.wx = {
  switchTab(options) {
    switchedTo = options.url;
    if (options.complete) options.complete();
  }
};

const tabSwipe = require("../miniprogram/utils/tab-swipe");

function swipe(page, currentPath, start, end, dataset) {
  switchedTo = "";
  page.setData = values => { page.data = Object.assign({}, page.data, values); };
  tabSwipe.start(page, {
    touches: [{ clientX: start[0], clientY: start[1] }],
    target: { dataset: dataset || {} }
  });
  tabSwipe.move(page, {
    touches: [{
      clientX: start[0] + (end[0] - start[0]) * 0.8,
      clientY: start[1] + (end[1] - start[1]) * 0.8
    }]
  }, currentPath);
  tabSwipe.end(page, {
    changedTouches: [{ clientX: end[0], clientY: end[1] }]
  }, currentPath);
  return switchedTo;
}

assert.strictEqual(
  swipe({}, "/pages/device/device", [220, 100], [120, 108]),
  "/pages/partners/partners"
);
assert.strictEqual(
  swipe({}, "/pages/partners/partners", [120, 100], [220, 106]),
  "/pages/device/device"
);
assert.strictEqual(swipe({}, "/pages/device/device", [120, 100], [130, 210]), "");
assert.strictEqual(swipe({}, "/pages/device/device", [220, 100], [120, 105], { noSwipe: "true" }), "");
assert.strictEqual(swipe({}, "/pages/home/home", [120, 100], [220, 105]), "");

const enteringPage = { data: {}, setData(values) { this.data = Object.assign({}, this.data, values); } };
app.globalData.tabSwipeTransition = {
  targetPath: "/pages/partners/partners",
  direction: 1,
  time: Date.now()
};
tabSwipe.enter(enteringPage, "/pages/partners/partners");
assert.match(enteringPage.data.tabSwipeStyle, /translate3d\(0\.0px/);
assert.strictEqual(app.globalData.tabSwipeTransition, null);

global.setTimeout = originalSetTimeout;
console.log("tab swipe tests passed");

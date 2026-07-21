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
assert.strictEqual(swipe({}, "/pages/unknown/unknown", [120, 100], [220, 105]), "");

function trackedOffset(currentPath, startX, currentX) {
  const page = {
    data: {},
    setData(values) { this.data = Object.assign({}, this.data, values); }
  };
  tabSwipe.start(page, {
    touches: [{ clientX: startX, clientY: 100 }],
    target: { dataset: {} }
  });
  tabSwipe.move(page, {
    touches: [{ clientX: currentX, clientY: 104 }]
  }, currentPath);
  const match = page.data.tabSwipeStyle.match(/translate3d\((-?[\d.]+)px/);
  return Number(match[1]);
}

assert.strictEqual(
  trackedOffset("/pages/device/device", 260, 160),
  -100,
  "有效方向应保持 1:1 跟手"
);
assert.ok(
  trackedOffset("/pages/device/device", 120, 220) < 20,
  "第一页继续右滑时应有明显的渐进阻尼"
);

const longDragOffset = trackedOffset("/pages/device/device", 500, 100);
assert.ok(
  longDragOffset < -260 && longDragOffset > -340,
  "有效方向长距离拖动应在接近页面边缘时平滑阻尼，不能在 36% 处突然停止"
);

const enteringPage = { data: {}, setData(values) { this.data = Object.assign({}, this.data, values); } };
app.globalData.tabSwipeTransition = {
  targetPath: "/pages/partners/partners",
  direction: 1,
  time: Date.now()
};
tabSwipe.enter(enteringPage, "/pages/partners/partners");
assert.match(enteringPage.data.tabSwipeStyle, /translate3d\(0\.0px/);
assert.match(enteringPage.data.tabSwipeStyle, /scale\(1\.0000\)/);
assert.strictEqual(app.globalData.tabSwipeTransition, null);

global.setTimeout = originalSetTimeout;
console.log("tab swipe tests passed");

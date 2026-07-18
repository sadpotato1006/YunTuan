const TAB_PATHS = [
  "/pages/home/home",
  "/pages/device/device",
  "/pages/partners/partners",
  "/pages/emotion/emotion",
  "/pages/settings/settings"
];

const MIN_DISTANCE = 64;
const MIN_FLICK_DISTANCE = 28;
const DIRECTION_LOCK_DISTANCE = 10;
const DIRECTION_RATIO = 1.35;
const MIN_FLICK_VELOCITY = 450;
const MAX_TRACK_OFFSET = 48;

function start(page, event) {
  const touches = event && event.touches;
  const targetData = event && event.target && event.target.dataset;
  if (!page || !touches || touches.length !== 1 || isSwipeDisabled(targetData)) {
    if (page) page._tabSwipeStart = null;
    return;
  }
  page._tabSwipeStart = {
    x: Number(touches[0].clientX) || 0,
    y: Number(touches[0].clientY) || 0,
    time: Date.now(),
    lastX: Number(touches[0].clientX) || 0,
    lastTime: Date.now(),
    velocityX: 0,
    horizontal: false
  };
  clearTimeout(page._tabSwipeResetTimer);
  clearTimeout(page._tabSwipeEnterTimer);
}

function move(page, event, currentPath) {
  if (!page || page._tabSwipeSwitching || !page._tabSwipeStart) return;
  const touches = event && event.touches;
  if (!touches || touches.length !== 1) return;
  const point = touches[0];
  const startPoint = page._tabSwipeStart;
  const x = Number(point.clientX) || 0;
  const y = Number(point.clientY) || 0;
  const deltaX = x - startPoint.x;
  const deltaY = y - startPoint.y;

  if (!startPoint.horizontal) {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DIRECTION_LOCK_DISTANCE) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * DIRECTION_RATIO) {
      page._tabSwipeStart = null;
      return;
    }
    startPoint.horizontal = true;
  }

  const index = TAB_PATHS.indexOf(currentPath);
  const atBoundary = (index === 0 && deltaX > 0) ||
    (index === TAB_PATHS.length - 1 && deltaX < 0);
  const resistance = atBoundary ? 0.12 : 0.28;
  const offset = clamp(deltaX * resistance, -MAX_TRACK_OFFSET, MAX_TRACK_OFFSET);
  const opacity = 1 - Math.min(Math.abs(offset) / 420, 0.1);
  setMotionStyle(page, offset, opacity, "none");
  const sampleDuration = Math.max(16, Date.now() - startPoint.lastTime);
  startPoint.velocityX = ((x - startPoint.lastX) / sampleDuration) * 1000;
  startPoint.lastX = x;
  startPoint.lastTime = Date.now();
}

function end(page, event, currentPath) {
  if (!page) return;
  if (page._tabSwipeSwitching) {
    page._tabSwipeStart = null;
    return;
  }
  const startPoint = page._tabSwipeStart;
  page._tabSwipeStart = null;
  const touch = event && event.changedTouches && event.changedTouches[0];
  if (!startPoint || !touch) return;

  const endX = Number(touch.clientX) || 0;
  const deltaX = endX - startPoint.x;
  const deltaY = (Number(touch.clientY) || 0) - startPoint.y;
  const velocityDuration = Math.max(16, Date.now() - startPoint.lastTime);
  const finalVelocity = ((endX - startPoint.lastX) / velocityDuration) * 1000;
  const velocityX = Math.abs(finalVelocity) > 60 ? finalVelocity : startPoint.velocityX;
  const horizontal = startPoint.horizontal || (
    Math.abs(deltaX) >= DIRECTION_LOCK_DISTANCE &&
    Math.abs(deltaX) >= Math.abs(deltaY) * DIRECTION_RATIO
  );
  const hasDistance = Math.abs(deltaX) >= MIN_DISTANCE;
  const hasFlick = Math.abs(deltaX) >= MIN_FLICK_DISTANCE &&
    Math.abs(velocityX) >= MIN_FLICK_VELOCITY &&
    Math.sign(velocityX) === Math.sign(deltaX);
  if (
    !horizontal ||
    (!hasDistance && !hasFlick) ||
    Math.abs(deltaX) < Math.abs(deltaY) * DIRECTION_RATIO
  ) {
    settle(page);
    return;
  }

  const currentIndex = TAB_PATHS.indexOf(currentPath);
  const targetIndex = currentIndex + (deltaX < 0 ? 1 : -1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= TAB_PATHS.length) {
    settle(page);
    return;
  }

  const direction = targetIndex > currentIndex ? 1 : -1;
  page._tabSwipeSwitching = true;
  setMotionStyle(
    page,
    direction > 0 ? -56 : 56,
    0.82,
    "transform 150ms cubic-bezier(.22,.61,.36,1), opacity 130ms ease-out"
  );
  page._tabSwipeResetTimer = setTimeout(() => {
    rememberTransition(TAB_PATHS[targetIndex], direction);
    wx.switchTab({
      url: TAB_PATHS[targetIndex],
      fail() { clearRememberedTransition(TAB_PATHS[targetIndex]); },
      complete() {
        setMotionStyle(page, 0, 1, "none");
        page._tabSwipeSwitching = false;
      }
    });
  }, 135);
}

function cancel(page) {
  if (!page) return;
  page._tabSwipeStart = null;
  settle(page);
}

function enter(page, currentPath) {
  if (!page) return;
  const transition = getRememberedTransition();
  if (!transition || transition.targetPath !== currentPath || Date.now() - transition.time > 800) {
    clearRememberedTransition();
    return;
  }
  clearRememberedTransition(currentPath);
  const offset = transition.direction > 0 ? 34 : -34;
  setMotionStyle(page, offset, 0.88, "none");
  page._tabSwipeEnterTimer = setTimeout(() => {
    setMotionStyle(
      page,
      0,
      1,
      "transform 190ms cubic-bezier(.22,.61,.36,1), opacity 160ms ease-out"
    );
    page._tabSwipeResetTimer = setTimeout(() => setMotionStyle(page, 0, 1, "none"), 210);
  }, 16);
}

function isSwipeDisabled(dataset) {
  return Boolean(dataset && (dataset.noSwipe === true || dataset.noSwipe === "true"));
}

function settle(page) {
  setMotionStyle(
    page,
    0,
    1,
    "transform 180ms cubic-bezier(.22,.61,.36,1), opacity 150ms ease-out"
  );
  clearTimeout(page._tabSwipeResetTimer);
  page._tabSwipeResetTimer = setTimeout(() => setMotionStyle(page, 0, 1, "none"), 200);
}

function setMotionStyle(page, offset, opacity, transition) {
  if (!page || typeof page.setData !== "function") return;
  page.setData({
    tabSwipeStyle: [
      `transform: translate3d(${Number(offset).toFixed(1)}px, 0, 0)`,
      `opacity: ${Number(opacity).toFixed(3)}`,
      `transition: ${transition}`,
      "will-change: transform, opacity"
    ].join(";")
  });
}

function rememberTransition(targetPath, direction) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData) return;
  app.globalData.tabSwipeTransition = { targetPath, direction, time: Date.now() };
}

function getRememberedTransition() {
  const app = typeof getApp === "function" ? getApp() : null;
  return app && app.globalData ? app.globalData.tabSwipeTransition : null;
}

function clearRememberedTransition(targetPath) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData || !app.globalData.tabSwipeTransition) return;
  if (!targetPath || app.globalData.tabSwipeTransition.targetPath === targetPath) {
    app.globalData.tabSwipeTransition = null;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

module.exports = { TAB_PATHS, start, move, end, cancel, enter };

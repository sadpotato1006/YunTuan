const TAB_PATHS = [
  "/pages/device/device",
  "/pages/partners/partners"
];

const MIN_DISTANCE = 56;
const MIN_FLICK_DISTANCE = 24;
const DIRECTION_LOCK_DISTANCE = 10;
const DIRECTION_RATIO = 1.35;
const MIN_FLICK_VELOCITY = 380;
const MAX_PROJECTED_VELOCITY = 1600;
const VELOCITY_PROJECTION_SECONDS = 0.12;
const TRACK_SOFT_LIMIT_RATIO = 0.7;
const TRACK_MAX_RATIO = 0.88;
const EXIT_OFFSET_MIN_RATIO = 0.42;
const EXIT_OFFSET_MAX_RATIO = 0.52;
const ENTER_OFFSET_MIN_RATIO = 0.18;
const ENTER_OFFSET_MAX_RATIO = 0.26;
const DRAWER_EASING = "cubic-bezier(.2,.82,.2,1)";
const SETTLE_EASING = "cubic-bezier(.22,.72,0,1)";

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
  const viewportWidth = getViewportWidth();
  const offset = atBoundary
    ? rubberBand(deltaX, viewportWidth, 0.2)
    : softClamp(deltaX, viewportWidth);
  const progress = Math.min(Math.abs(offset) / Math.max(viewportWidth, 1), 1);
  const opacity = 1 - Math.min(progress * 0.14, 0.1);
  const scale = 1 - Math.min(progress * 0.018, 0.014);
  setMotionStyle(page, offset, opacity, "none", scale);
  const sampleDuration = Math.max(16, Date.now() - startPoint.lastTime);
  const sampleVelocity = ((x - startPoint.lastX) / sampleDuration) * 1000;
  startPoint.velocityX = startPoint.velocityX * 0.35 + sampleVelocity * 0.65;
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
  const velocityX = Math.abs(finalVelocity) > Math.abs(startPoint.velocityX)
    ? finalVelocity
    : startPoint.velocityX;
  const horizontal = startPoint.horizontal || (
    Math.abs(deltaX) >= DIRECTION_LOCK_DISTANCE &&
    Math.abs(deltaX) >= Math.abs(deltaY) * DIRECTION_RATIO
  );
  const viewportWidth = getViewportWidth();
  const projectedDelta = deltaX + clamp(
    velocityX,
    -MAX_PROJECTED_VELOCITY,
    MAX_PROJECTED_VELOCITY
  ) * VELOCITY_PROJECTION_SECONDS;
  const projectedThreshold = Math.min(96, viewportWidth * 0.24);
  const hasDistance = Math.abs(deltaX) >= MIN_DISTANCE || (
    Math.sign(projectedDelta) === Math.sign(deltaX) &&
    Math.abs(projectedDelta) >= projectedThreshold
  );
  const hasFlick = Math.abs(deltaX) >= MIN_FLICK_DISTANCE &&
    Math.abs(velocityX) >= MIN_FLICK_VELOCITY &&
    Math.sign(velocityX) === Math.sign(deltaX);
  if (
    !horizontal ||
    (!hasDistance && !hasFlick) ||
    Math.abs(deltaX) < Math.abs(deltaY) * DIRECTION_RATIO
  ) {
    settle(page, velocityX);
    return;
  }

  const currentIndex = TAB_PATHS.indexOf(currentPath);
  const targetIndex = currentIndex + (deltaX < 0 ? 1 : -1);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= TAB_PATHS.length) {
    settle(page, velocityX);
    return;
  }

  const direction = targetIndex > currentIndex ? 1 : -1;
  page._tabSwipeSwitching = true;
  const speedRatio = Math.min(Math.abs(velocityX) / MAX_PROJECTED_VELOCITY, 1);
  const exitRatio = lerp(EXIT_OFFSET_MIN_RATIO, EXIT_OFFSET_MAX_RATIO, speedRatio);
  const exitOffset = (direction > 0 ? -1 : 1) * viewportWidth * exitRatio;
  const currentOffset = Number(page._tabSwipeOffset) || 0;
  const exitDuration = motionDuration(exitOffset - currentOffset, viewportWidth, velocityX, 125, 225);
  const entryOffsetRatio = lerp(ENTER_OFFSET_MIN_RATIO, ENTER_OFFSET_MAX_RATIO, speedRatio);
  const entryDuration = Math.round(lerp(250, 190, speedRatio));
  setMotionStyle(
    page,
    exitOffset,
    0.9,
    `transform ${exitDuration}ms ${DRAWER_EASING}, opacity ${Math.max(exitDuration - 35, 110)}ms ease-out`,
    0.986
  );
  page._tabSwipeResetTimer = setTimeout(() => {
    rememberTransition(TAB_PATHS[targetIndex], direction, { entryOffsetRatio, entryDuration });
    wx.switchTab({
      url: TAB_PATHS[targetIndex],
      fail() { clearRememberedTransition(TAB_PATHS[targetIndex]); },
      complete() {
        setMotionStyle(page, 0, 1, "none");
        page._tabSwipeSwitching = false;
      }
    });
  }, Math.max(100, exitDuration - 24));
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
  const entryOffsetRatio = clamp(
    Number(transition.entryOffsetRatio) || ENTER_OFFSET_MIN_RATIO,
    ENTER_OFFSET_MIN_RATIO,
    ENTER_OFFSET_MAX_RATIO
  );
  const duration = clamp(Number(transition.entryDuration) || 230, 180, 260);
  const offset = getViewportWidth() * entryOffsetRatio * (transition.direction > 0 ? 1 : -1);
  setMotionStyle(page, offset, 0.9, "none", 0.992);
  page._tabSwipeEnterTimer = setTimeout(() => {
    setMotionStyle(
      page,
      0,
      1,
      `transform ${duration}ms ${DRAWER_EASING}, opacity ${Math.max(duration - 35, 150)}ms ease-out`,
      1
    );
    page._tabSwipeResetTimer = setTimeout(() => setMotionStyle(page, 0, 1, "none"), duration + 24);
  }, 16);
}

function isSwipeDisabled(dataset) {
  return Boolean(dataset && (dataset.noSwipe === true || dataset.noSwipe === "true"));
}

function settle(page, velocityX = 0) {
  const currentOffset = Number(page && page._tabSwipeOffset) || 0;
  if (Math.abs(currentOffset) < 1) {
    setMotionStyle(page, 0, 1, "none", 1);
    return;
  }
  const duration = motionDuration(currentOffset, getViewportWidth(), velocityX, 165, 280);
  setMotionStyle(
    page,
    0,
    1,
    `transform ${duration}ms ${SETTLE_EASING}, opacity ${Math.max(duration - 40, 130)}ms ease-out`,
    1
  );
  clearTimeout(page._tabSwipeResetTimer);
  page._tabSwipeResetTimer = setTimeout(() => setMotionStyle(page, 0, 1, "none"), duration + 24);
}

function setMotionStyle(page, offset, opacity, transition, scale = 1) {
  if (!page || typeof page.setData !== "function") return;
  const numericOffset = Number(offset);
  const safeScale = clamp(Number(scale), 0.96, 1);
  page._tabSwipeOffset = numericOffset;
  const willChange = numericOffset !== 0 || transition !== "none"
    ? "transform, opacity"
    : "auto";
  page.setData({
    tabSwipeStyle: [
      `transform: translate3d(${numericOffset.toFixed(1)}px, 0, 0) scale(${safeScale.toFixed(4)})`,
      `opacity: ${Number(opacity).toFixed(3)}`,
      `transition: ${transition}`,
      `will-change: ${willChange}`
    ].join(";")
  });
}

function getViewportWidth() {
  try {
    if (typeof wx !== "undefined" && typeof wx.getWindowInfo === "function") {
      const width = Number(wx.getWindowInfo().windowWidth);
      if (width > 0) return width;
    }
    if (typeof wx !== "undefined" && typeof wx.getSystemInfoSync === "function") {
      const width = Number(wx.getSystemInfoSync().windowWidth);
      if (width > 0) return width;
    }
  } catch (error) {
    // 系统信息读取失败时使用稳定的手机宽度回退值。
  }
  return 375;
}

function rubberBand(distance, dimension, constant) {
  const absoluteDistance = Math.abs(distance);
  if (!absoluteDistance || !dimension) return 0;
  const resisted = (absoluteDistance * dimension * constant) /
    (dimension + constant * absoluteDistance);
  return Math.sign(distance) * resisted;
}

function softClamp(distance, dimension) {
  const size = Math.max(Number(dimension) || 1, 1);
  const value = Number(distance) || 0;
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const softLimit = size * TRACK_SOFT_LIMIT_RATIO;
  const maxOffset = size * TRACK_MAX_RATIO;
  if (absolute <= softLimit) return value;
  const resisted = softLimit + rubberBand(absolute - softLimit, size, 0.24);
  return sign * Math.min(resisted, maxOffset);
}

function motionDuration(distance, width, velocityX, minimum, maximum) {
  const distanceRatio = clamp(
    Math.abs(Number(distance) || 0) / Math.max(Number(width) || 1, 1),
    0,
    1
  );
  const speedRatio = clamp(Math.abs(Number(velocityX) || 0) / MAX_PROJECTED_VELOCITY, 0, 1);
  return Math.round(clamp(170 + distanceRatio * 120 - speedRatio * 75, minimum, maximum));
}

function lerp(from, to, progress) {
  return from + (to - from) * clamp(progress, 0, 1);
}

function rememberTransition(targetPath, direction, motion = {}) {
  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || !app.globalData) return;
  app.globalData.tabSwipeTransition = Object.assign(
    { targetPath, direction, time: Date.now() },
    motion
  );
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

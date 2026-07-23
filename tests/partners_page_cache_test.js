const assert = require("assert");

const storage = new Map();
let inboxCalls = 0;
let blockedCalls = 0;
let pageDefinition = null;

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  stopPullDownRefresh() {},
  showToast() {},
  navigateTo() {}
};
global.getApp = () => ({
  setSocialForegroundView() {},
  clearSocialForegroundView() {},
  setSocialBadgeCount() {}
});
global.Page = definition => { pageDefinition = definition; };
global.setTimeout = callback => ({ callback });
global.clearTimeout = () => {};

function stubModule(relativePath, exports) {
  const modulePath = require.resolve(relativePath);
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports
  };
}

stubModule("../miniprogram/services/social", {
  async getSocialInbox() {
    inboxCalls += 1;
    return {
      greetings: [],
      matches: [{
        conversationId: "conversation-cloud",
        matchedAt: 2,
        unreadCount: 0,
        profile: { avatarType: "virtual", avatarValue: "🌻", nickname: "云端伙伴" }
      }],
      pagination: {
        friends: { hasMore: false, nextCursor: "" },
        greetings: { hasMore: false, nextCursor: "" }
      }
    };
  },
  async getBlockedUsers() { blockedCalls += 1; return []; }
});
stubModule("../miniprogram/services/device", {
  getEncounterRecords() { return []; }
});
stubModule("../miniprogram/utils/tab-swipe", {
  enter() {}, start() {}, move() {}, end() {}, cancel() {}
});

const cache = require("../miniprogram/services/social-inbox-cache");
cache.writeInbox({
  greetings: [],
  matches: [{
    conversationId: "conversation-local",
    matchedAt: 1,
    unreadCount: 0,
    profile: { avatarType: "virtual", avatarValue: "☁️", nickname: "本地伙伴" }
  }],
  blockedUsers: [],
  pagination: {
    friends: { hasMore: false, nextCursor: "" },
    greetings: { hasMore: false, nextCursor: "" }
  },
  syncedAt: Date.now()
});

require("../miniprogram/pages/partners/partners");
assert.ok(pageDefinition);
const page = Object.assign({}, pageDefinition, {
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(patch) { Object.assign(this.data, patch); }
});

page.onShow();
assert.strictEqual(inboxCalls, 0, "新鲜伙伴缓存不应在进入页面时请求云函数");
assert.strictEqual(blockedCalls, 0);
assert.strictEqual(page.data.loading, false);
assert.strictEqual(page.data.matches[0].profile.nickname, "本地伙伴");

page.loadInbox(false, { force: true }).then(() => {
  assert.strictEqual(inboxCalls, 1, "手动刷新应同步一次云端");
  assert.strictEqual(blockedCalls, 1);
  assert.strictEqual(page.data.matches[0].profile.nickname, "云端伙伴");
  assert.strictEqual(cache.readInbox().matches[0].profile.nickname, "云端伙伴");
  page.onHide();
  console.log("partners page cache tests passed");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

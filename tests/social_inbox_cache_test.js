const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); }
};

const cache = require("../miniprogram/services/social-inbox-cache");
const now = Date.now();
cache.writeInbox({
  greetings: [{
    greetingId: "greeting-1",
    createdAt: 1,
    avatarFailed: true,
    profile: { nickname: "招呼伙伴", avatarDisplayUrl: "temporary", avatarFallback: "招" }
  }],
  matches: [{
    conversationId: "conversation-1",
    unreadCount: 2,
    newMatch: false,
    summary: "界面派生摘要",
    profile: { nickname: "缓存伙伴", avatarValue: "☁️" }
  }],
  blockedUsers: [],
  pagination: {
    friends: { hasMore: true, nextCursor: "friend-cursor" },
    greetings: { hasMore: false, nextCursor: "" }
  },
  syncedAt: now
});

const saved = cache.readInbox();
assert.ok(saved);
assert.strictEqual(saved.matches[0].profile.nickname, "缓存伙伴");
assert.ok(!("summary" in saved.matches[0]));
assert.ok(!("avatarFailed" in saved.greetings[0]));
assert.ok(!("avatarDisplayUrl" in saved.greetings[0].profile));
assert.strictEqual(saved.pagination.friends.nextCursor, "friend-cursor");
assert.strictEqual(cache.isFresh(saved, now + 1000), true);
assert.strictEqual(cache.isFresh(saved, now + cache.CACHE_FRESH_MS + 1), false);
assert.strictEqual(cache.badgeCount(saved), 3);

cache.mergeFirstPage({
  greetings: [],
  matches: [{
    conversationId: "conversation-2",
    unreadCount: 0,
    newMatch: true,
    profile: { nickname: "新伙伴" }
  }],
  pagination: {
    friends: { hasMore: true, nextCursor: "next" },
    greetings: { hasMore: false, nextCursor: "" }
  }
}, now + 2000);

const merged = cache.readInbox();
assert.deepStrictEqual(merged.greetings, [], "云端确认没有更多招呼时应清除旧招呼");
assert.deepStrictEqual(
  merged.matches.map(item => item.conversationId),
  ["conversation-2", "conversation-1"]
);
assert.strictEqual(merged.syncedAt, now + 2000);
console.log("social inbox cache tests passed");

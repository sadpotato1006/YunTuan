const assert = require("assert");

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); }
};

const cache = require("../miniprogram/services/social-chat-cache");
const conversationId = "a".repeat(64);
const messages = Array.from({ length: 105 }, (_, index) => ({
  id: `message-${index}`,
  content: `内容 ${index}`,
  createdAt: index + 1
}));

assert.strictEqual(cache.readConversation(conversationId), null);
assert.strictEqual(cache.writeConversation("invalid", {}), false);
assert.strictEqual(cache.writeConversation(conversationId, {
  profile: { nickname: "伙伴" },
  messages,
  hasMoreMessages: false,
  messageCursor: 0,
  messagePolicy: { limited: false },
  contactExchange: { status: "none" },
  syncedAt: 1000
}), true);

const saved = cache.readConversation(conversationId);
assert.strictEqual(saved.messages.length, cache.MAX_MESSAGES_PER_CONVERSATION);
assert.strictEqual(saved.messages[0].id, "message-5");
assert.strictEqual(saved.hasMoreMessages, true);
assert.strictEqual(saved.messageCursor, 6);
assert.strictEqual(cache.isFresh(saved, 1000 + cache.CACHE_FRESH_MS - 1), true);
assert.strictEqual(cache.isFresh(saved, 1000 + cache.CACHE_FRESH_MS), false);
assert.strictEqual(cache.patchConversation(conversationId, {
  contactExchange: { status: "accepted" }
}), true);
assert.strictEqual(cache.readConversation(conversationId).contactExchange.status, "accepted");
assert.strictEqual(cache.readConversation(conversationId).syncedAt, 1000);

for (let index = 0; index < cache.MAX_CONVERSATIONS + 2; index += 1) {
  const id = index.toString(16).padStart(64, "0");
  cache.writeConversation(id, { messages: [], syncedAt: index + 1 });
}
const store = storage.get("yuntuan_social_chat_cache_v1");
assert.strictEqual(Object.keys(store.entries).length, cache.MAX_CONVERSATIONS);

assert.strictEqual(cache.removeConversation(conversationId), true);
assert.strictEqual(cache.readConversation(conversationId), null);

console.log("social chat cache tests passed");

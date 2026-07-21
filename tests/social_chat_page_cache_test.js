const assert = require("assert");

const storage = new Map();
let getConversationCalls = 0;
let sendMessageCalls = 0;
let pageDefinition = null;
let lastConversationOptions = null;

global.wx = {
  getStorageSync(key) { return storage.get(key); },
  setStorageSync(key, value) { storage.set(key, value); },
  setNavigationBarTitle() {},
  stopPullDownRefresh() {},
  showToast() {}
};
global.getApp = () => ({
  setSocialForegroundView() {},
  clearSocialForegroundView() {}
});
global.Page = definition => { pageDefinition = definition; };
global.setTimeout = callback => ({ callback });
global.clearTimeout = () => {};

const socialServicePath = require.resolve("../miniprogram/services/social");
require.cache[socialServicePath] = {
  id: socialServicePath,
  filename: socialServicePath,
  loaded: true,
  exports: {
    createSocialRequestId: () => "request-1",
    async getConversation(conversationId, options) {
      getConversationCalls += 1;
      lastConversationOptions = options;
      return {
        conversation: { profile: { nickname: "缓存伙伴", tags: [] } },
        messages: [],
        pagination: { hasMore: false, nextCursor: 0, direction: "after" },
        messagePolicy: { limited: false },
        contactExchange: { status: "none" }
      };
    },
    async sendSocialMessage(conversationId, content, requestId) {
      sendMessageCalls += 1;
      assert.strictEqual(content, "本地追加消息");
      assert.strictEqual(requestId, "request-1");
      return {
        message: {
          id: "message-2",
          sender: "me",
          content,
          createdAt: Date.now()
        }
      };
    }
  }
};

const cache = require("../miniprogram/services/social-chat-cache");
const conversationId = "b".repeat(64);
cache.writeConversation(conversationId, {
  profile: { nickname: "缓存伙伴", tags: [] },
  messages: [{ id: "message-1", sender: "peer", content: "缓存消息", createdAt: 1 }],
  messagePolicy: { limited: false },
  contactExchange: { status: "none" },
  syncedAt: Date.now()
});

require("../miniprogram/pages/social-chat/social-chat");
assert.ok(pageDefinition);

const page = Object.assign({}, pageDefinition, {
  data: JSON.parse(JSON.stringify(pageDefinition.data)),
  setData(patch, callback) {
    Object.assign(this.data, patch);
    if (typeof callback === "function") callback();
  }
});

page.onLoad({ conversationId });
page.onShow();
assert.strictEqual(getConversationCalls, 0, "新鲜本地缓存不应在进入页面时再次拉云端");
assert.strictEqual(page.data.messages[0].content, "缓存消息");

page.setData({ inputValue: "本地追加消息" });
page.sendMessage().then(() => {
  assert.strictEqual(sendMessageCalls, 1);
  assert.strictEqual(getConversationCalls, 0, "发送成功后不应再拉取整段会话");
  assert.strictEqual(page.data.messages.length, 2);
  assert.strictEqual(cache.readConversation(conversationId).messages.length, 2);
  return page.loadConversation(true);
}).then(() => {
  assert.strictEqual(getConversationCalls, 1);
  assert.strictEqual(
    lastConversationOptions.afterCreatedAt,
    page.data.messages[page.data.messages.length - 1].createdAt,
    "轮询应从本地最后一条消息之后开始增量读取"
  );
  console.log("social chat page cache tests passed");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});

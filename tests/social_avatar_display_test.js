const assert = require("assert");
const fs = require("fs");
const path = require("path");

const fileId = "cloud://test-env/social-avatars/friend.jpg";
let tempUrlCalls = 0;
global.wx = {
  cloud: {
    getTempFileURL(options) {
      tempUrlCalls += 1;
      options.success({
        fileList: [{
          fileID: fileId,
          status: 0,
          tempFileURL: "https://example.test/friend.jpg"
        }]
      });
    }
  }
};

const socialAvatar = require("../miniprogram/services/social-avatar");
const socialChatCache = require("../miniprogram/services/social-chat-cache");

(async () => {
  const source = {
    avatarType: "custom",
    avatarValue: fileId,
    avatarColor: "#DFECE5",
    nickname: "小云"
  };
  const unresolved = socialAvatar.toDisplayProfile(source);
  assert.strictEqual(unresolved.avatarDisplayUrl, "", "cloud file IDs must not be rendered as image URLs");
  assert.strictEqual(unresolved.avatarFallback, "小");
  const resolved = await socialAvatar.resolveDisplayProfile(source);
  assert.strictEqual(resolved.avatarValue, fileId, "must retain the stable cloud file ID");
  assert.strictEqual(resolved.avatarDisplayUrl, "https://example.test/friend.jpg");
  assert.strictEqual(resolved.avatarFallback, "小");

  const cachedResolved = await socialAvatar.resolveDisplayProfile(source);
  assert.strictEqual(cachedResolved.avatarDisplayUrl, resolved.avatarDisplayUrl);
  assert.strictEqual(tempUrlCalls, 1, "temporary avatar URLs should be reused briefly");

  const cacheValue = socialAvatar.toCacheProfile(resolved);
  assert.strictEqual(cacheValue.avatarValue, fileId);
  assert.ok(!("avatarDisplayUrl" in cacheValue), "temporary URLs must not enter persistent chat cache");
  assert.ok(!("avatarFallback" in cacheValue));

  const virtual = await socialAvatar.resolveDisplayProfile({
    avatarType: "virtual",
    avatarValue: "☁️",
    nickname: "云团朋友"
  });
  assert.strictEqual(virtual.avatarValue, "☁️");
  assert.strictEqual(virtual.avatarDisplayUrl, "");
  assert.strictEqual(tempUrlCalls, 1);

  const originalWx = global.wx;
  global.wx = {
    getStorageSync() { return { version: 1, entries: {} }; },
    setStorageSync(key, value) { this.saved = { key, value }; }
  };
  socialChatCache.writeConversation("a".repeat(64), {
    profile: resolved,
    messages: []
  });
  const stored = global.wx.saved.value.entries["a".repeat(64)].profile;
  assert.strictEqual(stored.avatarValue, fileId);
  assert.ok(!("avatarDisplayUrl" in stored));
  global.wx = originalWx;

  const chatPage = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "pages", "social-chat", "social-chat.js"),
    "utf8"
  );
  const chatView = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "pages", "social-chat", "social-chat.wxml"),
    "utf8"
  );
  assert.match(chatPage, /resolvePartnerAvatar\(profile\)/);
  assert.match(chatPage, /partnerAvatarFailed:\s*true/);
  assert.match(chatView, /src="\{\{profile\.avatarDisplayUrl\}\}"/);
  assert.match(chatView, /binderror="handlePartnerAvatarError"/);

  const partnersPage = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "pages", "partners", "partners.js"),
    "utf8"
  );
  const partnersView = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "pages", "partners", "partners.wxml"),
    "utf8"
  );
  assert.match(partnersPage, /require\("\.\.\/\.\.\/services\/social-avatar"\)/);
  assert.match(partnersPage, /resolveInboxAvatars\(\{ greetings, matches, blockedUsers \}\)/);
  assert.match(partnersView, /item\.profile\.avatarDisplayUrl/);
  assert.match(partnersView, /item\.profile\.avatarFallback/);
  assert.match(partnersView, /binderror="handleInboxAvatarError"/);

  const encountersPage = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "pages", "encounters", "encounters.js"),
    "utf8"
  );
  const encountersView = fs.readFileSync(
    path.join(__dirname, "..", "miniprogram", "pages", "encounters", "encounters.wxml"),
    "utf8"
  );
  assert.match(encountersPage, /require\("\.\.\/\.\.\/services\/social-avatar"\)/);
  assert.match(encountersPage, /resolveDisplayProfile\(profileValue/);
  assert.match(encountersView, /item\.profile\.avatarDisplayUrl/);
  assert.match(encountersView, /item\.profile\.avatarFallback/);
  assert.match(encountersView, /binderror="handleAvatarError"/);

  console.log("social avatar display tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

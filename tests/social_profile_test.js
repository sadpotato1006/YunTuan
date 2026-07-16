const assert = require("assert");
const fs = require("fs");
const path = require("path");

let storage = {};
global.wx = {
  getStorageSync(key) { return storage[key]; },
  setStorageSync(key, value) { storage[key] = value; }
};

const profileService = require("../miniprogram/services/social-profile");

const normalized = profileService.normalizeProfile({
  avatarType: "virtual",
  avatarValue: "🐳",
  avatarColor: "#DDECF5",
  nickname: "  小 云  ",
  bio: "  想认识一起跑步的朋友  ",
  tags: ["跑步", "摄影", "跑步", "音乐", "不应保留"],
  intention: "buddy",
  phone: "13800000000",
  openid: "must-not-leak",
  realName: "真实姓名",
  location: "精确位置",
  deviceId: "device-secret"
});

assert.strictEqual(normalized.nickname, "小 云");
assert.strictEqual(normalized.bio, "想认识一起跑步的朋友");
assert.deepStrictEqual(normalized.tags, ["跑步", "摄影", "音乐"]);
assert.strictEqual(normalized.intention, "buddy");

const saved = profileService.saveProfile(normalized);
assert.deepStrictEqual(profileService.getProfile(), saved);
assert.ok(saved.updatedAt > 0);

const publicCard = profileService.toPublicCard(saved);
assert.deepStrictEqual(Object.keys(publicCard).sort(), [
  "avatarColor",
  "avatarType",
  "avatarValue",
  "bio",
  "intention",
  "intentionLabel",
  "nickname",
  "tags"
].sort());
assert.strictEqual(publicCard.intentionLabel, "找搭子");
assert.ok(!JSON.stringify(publicCard).includes("13800000000"));
assert.ok(!JSON.stringify(publicCard).includes("must-not-leak"));

const appConfig = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "app.json"),
  "utf8"
));
assert.ok(appConfig.pages.includes("pages/social-profile/social-profile"));

const pageWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "social-profile", "social-profile.wxml"),
  "utf8"
);
assert.match(pageWxml, /open-type="chooseAvatar"/);
assert.match(pageWxml, /打个招呼/);
assert.match(pageWxml, /兴趣标签/);
assert.match(pageWxml, /当前社交意愿/);

const settingsWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "settings", "settings.wxml"),
  "utf8"
);
assert.match(settingsWxml, /socialProfile\.nickname/);
assert.match(settingsWxml, /点击进入编辑名片/);

const deviceWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "device", "device.wxml"),
  "utf8"
);
assert.match(deviceWxml, /socialProfile\.avatarValue/);
assert.match(deviceWxml, /socialProfile\.nickname/);
assert.doesNotMatch(deviceWxml, /class="device-mark"/);

console.log("social profile tests passed");

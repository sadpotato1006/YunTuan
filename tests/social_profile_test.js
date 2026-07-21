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
  contactOptions: [
    { id: "contact_wechat_test", type: "wechat", label: "常用微信", value: "yun_tuan_test" },
    { id: "contact_phone_test", type: "phone", label: "备用手机", value: "13800000000" }
  ],
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
assert.strictEqual(normalized.contactOptions.length, 2);
const cloudProfile = profileService.toCloudProfile(normalized);
assert.strictEqual(cloudProfile.contactOptions, undefined);
assert.ok(!JSON.stringify(cloudProfile).includes("yun_tuan_test"));
assert.ok(!JSON.stringify(cloudProfile).includes("13800000000"));

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
assert.ok(!JSON.stringify(publicCard).includes("yun_tuan_test"));
assert.ok(!JSON.stringify(publicCard).includes("must-not-leak"));

const restored = profileService.fromCloudProfile({
  avatarType: "custom",
  avatarValue: "cloud://test-env/social-avatars/restored.jpg",
  avatarColor: "#DFECE5",
  nickname: "云端昵称",
  bio: "云端介绍",
  tags: ["摄影"],
  intention: "chat"
});
assert.strictEqual(restored.avatarValue, "cloud://test-env/social-avatars/restored.jpg");
assert.strictEqual(restored.avatarCloudFileId, restored.avatarValue);
assert.ok(restored.updatedAt > 0);

const appConfig = JSON.parse(fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "app.json"),
  "utf8"
));
assert.ok(appConfig.pages.includes("pages/social-profile/social-profile"));
assert.ok(appConfig.pages.includes("pages/encounters/encounters"));
assert.ok(!appConfig.pages.includes("pages/social-inbox/social-inbox"));

const pageWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "social-profile", "social-profile.wxml"),
  "utf8"
);
assert.match(pageWxml, /open-type="chooseAvatar"/);
assert.doesNotMatch(pageWxml, /真实相遇后向你打招呼/);
assert.match(pageWxml, /兴趣标签/);
assert.doesNotMatch(pageWxml, /当前社交意愿/);
assert.doesNotMatch(pageWxml, /selectIntention/);
assert.doesNotMatch(pageWxml, /intentionLabel/);
assert.match(pageWxml, /私密分享资料/);
assert.match(pageWxml, /只保存在本机/);

const deviceWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "device", "device.wxml"),
  "utf8"
);
assert.match(deviceWxml, /socialProfile\.avatarValue/);
assert.match(deviceWxml, /socialProfile\.nickname/);
assert.match(deviceWxml, /编辑个人名片/);
assert.match(deviceWxml, /bindtap="goSocialProfile"/);
assert.match(deviceWxml, /class="profile-edit-button"/);
assert.match(deviceWxml, /socialProfile\.bio/);
assert.match(deviceWxml, /socialProfile\.intentionLabel/);
assert.match(deviceWxml, /wx:for="{{socialProfile\.tags}}"/);
assert.doesNotMatch(deviceWxml, /class="profile-manage-button"/);
assert.doesNotMatch(deviceWxml, /class="device-mark"/);

const encountersWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "encounters", "encounters.wxml"),
  "utf8"
);
assert.match(encountersWxml, /item\.profile\.nickname/);
assert.match(encountersWxml, /重新获取名片/);
assert.match(encountersWxml, /bindtap="sendGreeting"/);
assert.match(encountersWxml, /打个招呼/);
assert.match(encountersWxml, /汇总最近 30 次相遇/);
assert.match(encountersWxml, /相遇 \{\{item\.encounterCount\}\} 次/);
assert.match(encountersWxml, /!item\.alreadyKnown/);

const partnersWxml = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "partners", "partners.wxml"),
  "utf8"
);
assert.match(partnersWxml, /认识 TA/);
assert.match(partnersWxml, /respondGreeting/);

console.log("social profile tests passed");

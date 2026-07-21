const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const tabMap = Object.fromEntries(app.tabBar.list.map(item => [item.pagePath, item.text]));

assert.strictEqual(tabMap["pages/home/home"], "首页");
assert.strictEqual(tabMap["pages/device/device"], "设备");
assert.strictEqual(tabMap["pages/partners/partners"], "伙伴");
assert.strictEqual(tabMap["pages/emotion/emotion"], "心情");
assert.strictEqual(tabMap["pages/settings/settings"], "我的");
assert.ok(app.pages.includes("pages/device-lab/device-lab"));

const home = read("miniprogram/pages/home/home.wxml");
assert.ok(!home.includes("quick-grid"), "首页不应重复堆叠底部导航入口");

const device = read("miniprogram/pages/device/device.wxml");
assert.ok(device.includes("最近相遇"));
assert.ok(device.includes("打个招呼"));
assert.ok(device.includes("设备详细信息"));
assert.ok(device.includes("社交提醒"));
assert.ok(device.includes("振动反馈"));
assert.ok(device.includes("声音提示"));
assert.ok(!device.includes("本机模拟 Token"), "正式设备页不应展示模拟 Token 工具");
assert.ok(!device.includes("设备管理"), "设备信息和调试工具应收进同一个详情入口");

const lab = read("miniprogram/pages/device-lab/device-lab.wxml");
assert.ok(lab.includes("设备详细信息"));
assert.ok(lab.includes("设备型号"));
assert.ok(lab.includes("断开当前设备"));
assert.ok(lab.includes("一个账号完整测试"));
assert.ok(lab.includes("两个账号联调"));
assert.ok(lab.includes("通用 BLE 联调工具"));

const settings = read("miniprogram/pages/settings/settings.wxml");
assert.ok(settings.includes("隐私与数据"));
assert.ok(!settings.includes("挂件提醒"));
assert.ok(!settings.includes("伙伴与消息"));
assert.ok(!settings.includes("相遇记录"));

const partners = read("miniprogram/pages/partners/partners.wxml");
assert.ok(partners.includes("conversation-list"));
assert.ok(partners.includes("朋友"));
assert.ok(partners.includes("招呼"));
assert.ok(partners.indexOf("朋友") < partners.indexOf("招呼"));
assert.ok(partners.includes("notice-dot"));
assert.ok(partners.includes('bindtap="toggleSection"'));
assert.ok(partners.includes('catchtap="respondGreeting"'));
assert.ok(!partners.includes('data-view="messages"'));
assert.ok(!partners.includes('data-view="people"'));

const tabSwipe = read("miniprogram/utils/tab-swipe.js");
assert.ok(tabSwipe.includes("MIN_DISTANCE = 64"));
[
  "home/home",
  "device/device",
  "partners/partners",
  "emotion/emotion",
  "settings/settings"
].forEach(page => {
  const wxml = read(`miniprogram/pages/${page}.wxml`);
  assert.ok(wxml.includes('bindtouchstart="onTabSwipeStart"'), `${page} 应支持左右滑动`);
  assert.ok(wxml.includes('bindtouchmove="onTabSwipeMove"'), `${page} 应提供跟手动画`);
  assert.ok(wxml.includes('style="{{tabSwipeStyle}}"'), `${page} 应绑定滑动过渡样式`);
});
const emotion = read("miniprogram/pages/emotion/emotion.wxml");
assert.ok(emotion.includes('data-no-swipe="true"'), "备注输入区不应触发页面滑动");

const aiChat = read("miniprogram/pages/chat/chat.wxml");
assert.ok(aiChat.includes("麦克风正常"));
assert.ok(aiChat.includes("扬声器正常"));
assert.ok(!aiChat.includes("短按挂件 PTT 键"), "AI 聊天页不应堆叠固件操作说明");
assert.ok(!aiChat.includes("手机麦克风备用"), "AI 聊天页应保持硬件状态区精简");

const chat = read("miniprogram/pages/social-chat/social-chat.wxml");
const chatStyle = read("miniprogram/pages/social-chat/social-chat.wxss");
assert.ok(chat.includes('<input class="message-input"'));
assert.ok(chat.includes("contact-access-summary"));
assert.ok(!chat.includes("contact-panel"), "联系方式详情不应在聊天页占据大块高度");
assert.ok(chatStyle.includes("min-height: 84rpx"));
assert.ok(!chatStyle.includes("height: 50vh"));
assert.ok(chatStyle.includes("flex: 0 0 64rpx"));
assert.ok(chatStyle.includes("flex: 0 0 116rpx"));
assert.ok(chatStyle.includes("flex: 1 1 0"));

console.log("ui information architecture tests passed");

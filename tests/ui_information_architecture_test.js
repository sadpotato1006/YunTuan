const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const app = JSON.parse(read("miniprogram/app.json"));
const tabMap = Object.fromEntries(app.tabBar.list.map(item => [item.pagePath, item.text]));

assert.deepStrictEqual(app.tabBar.list.map(item => item.pagePath), [
  "pages/device/device",
  "pages/partners/partners"
]);
assert.strictEqual(tabMap["pages/device/device"], "设备");
assert.strictEqual(tabMap["pages/partners/partners"], "伙伴");
assert.strictEqual(app.pages[0], "pages/device/device");
assert.ok(!app.pages.includes("pages/home/home"));
assert.ok(!app.pages.includes("pages/emotion/emotion"));
assert.ok(!app.pages.includes("pages/settings/settings"));
assert.ok(!fs.existsSync(path.join(root, "miniprogram", "services", "emotion.js")));
assert.ok(!fs.existsSync(path.join(root, "cloudfunctions", "emotion")) ||
  fs.readdirSync(path.join(root, "cloudfunctions", "emotion")).length === 0);
assert.ok(app.pages.includes("pages/device-lab/device-lab"));
assert.ok(app.pages.includes("pages/more/more"));

const device = read("miniprogram/pages/device/device.wxml");
const deviceJs = read("miniprogram/pages/device/device.js");
const deviceStyle = read("miniprogram/pages/device/device.wxss");
assert.ok(!device.includes("最近相遇"), "相遇入口不应继续占用设备页");
assert.ok(!device.includes("打个招呼"));
assert.ok(!device.includes("查看挂件状态，管理常用功能"), "设备页不应保留标题副文案");
assert.ok(!device.includes("设备型号"), "老人使用的设备页不应展示型号");
assert.ok(!device.includes("固件版本"), "老人使用的设备页不应展示固件版本");
assert.ok(!device.includes("硬件版本"), "老人使用的设备页不应展示硬件版本");
assert.ok(device.includes("更多"));
assert.ok(deviceJs.includes('wx.navigateTo({ url: "/pages/more/more" })'));
assert.ok(!device.includes("社交模式"), "硬件设置不应继续占用设备首页");
assert.ok(!device.includes("震动反馈"), "硬件设置不应继续占用设备首页");
assert.ok(!device.includes("常用功能"));
assert.ok(!device.includes("隐私与数据"));
assert.ok(!device.includes("开发者工具"));
assert.ok(device.includes("提醒查找挂件"));
assert.ok(device.includes("断开连接"));
assert.ok(device.indexOf("提醒查找挂件") < device.indexOf("断开连接"), "首页查找按钮应在左，断开按钮应在右");
assert.ok(deviceJs.includes("runDisconnectDevice"));
assert.ok(deviceStyle.includes(".device-action-row { display: flex"));
assert.ok(!device.includes("社交提醒"));
assert.ok(!device.includes("声音提示"));
assert.ok(device.includes("编辑个人名片"));
assert.ok(!device.includes("socialProfile.bio"), "设备首页不应显示个人介绍");
assert.ok(!device.includes("socialProfile.intentionLabel"), "设备首页不应显示社交意愿");
assert.ok(!device.includes('class="device-name"'), "设备首页不应显示设备编号");
assert.match(deviceStyle, /\.owner-nickname \{[^}]*font-size: 40rpx/s, "首页用户名应略微放大");
assert.ok(!read("miniprogram/services/data-privacy.js").includes("emotion"));
assert.ok(!device.includes("本机模拟 Token"), "正式设备页不应展示模拟 Token 工具");
assert.ok(!device.includes("设备 ID"), "老人使用的扫描列表不应展示底层设备 ID");
assert.ok(!device.includes("dBm"), "老人使用的扫描列表不应展示 RSSI 技术值");
assert.ok(deviceStyle.includes("font-size: 29rpx"), "设备页正文应使用适老化字号");
assert.ok(deviceStyle.includes("width: 120rpx"), "名片编辑按钮应固定为右侧小按钮");

const more = read("miniprogram/pages/more/more.wxml");
const moreJs = read("miniprogram/pages/more/more.js");
const moreStyle = read("miniprogram/pages/more/more.wxss");
assert.ok(more.includes("硬件设置"));
assert.ok(more.includes("社交模式"));
assert.ok(more.includes("震动反馈"));
assert.ok(more.includes("隐私与数据"));
assert.ok(more.includes("开发者工具"));
assert.ok(!more.includes("提醒查找挂件"));
assert.ok(!more.includes("断开连接"));
assert.ok(more.includes("清除本机缓存"));
assert.ok(more.includes("删除全部个人数据"));
assert.ok(more.includes('wx:if="{{showPrivateTools}}"'), "低频隐私工具应默认折叠");
assert.ok(moreJs.includes("dataPrivacyService.deleteCloudData()"));
assert.ok(moreJs.includes('wx.navigateTo({ url: "/pages/device-lab/device-lab" })'));
assert.ok(moreStyle.includes("font-size: 34rpx"), "更多页主要设置应使用适老化字号");
assert.ok(moreStyle.includes("min-height: 96rpx"), "更多页主要操作应有足够大的触控区域");

const lab = read("miniprogram/pages/device-lab/device-lab.wxml");
assert.ok(lab.includes("开发者工具"));
assert.ok(lab.includes("设备型号"));
assert.ok(lab.includes("固件版本"));
assert.ok(lab.includes("硬件版本"));
assert.ok(lab.includes("协议版本"));
assert.ok(lab.includes("断开当前设备"));
assert.ok(lab.includes("一个账号完整测试"));
assert.ok(lab.includes("两个账号联调"));
assert.ok(lab.includes("通用 BLE 联调工具"));

const partners = read("miniprogram/pages/partners/partners.wxml");
const partnersStyle = read("miniprogram/pages/partners/partners.wxss");
const partnersJs = read("miniprogram/pages/partners/partners.js");
assert.ok(partners.includes("和云团 AI 聊天"));
assert.ok(partners.includes("开始聊天"), "AI 聊天入口应提供明确的行动按钮");
assert.ok(!partners.includes("和云团说说话，也可以联系认识的朋友"), "伙伴页不应保留标题副文案");
assert.ok(!partners.includes("想聊聊天、问点事情"), "伙伴入口不应堆叠解释性小字");
assert.ok(!partners.includes("查看最近遇见的"), "最近相遇入口不应堆叠解释性小字");
assert.ok(partners.includes('bindtap="openAiChat"'));
assert.ok(partners.includes("最近相遇"));
assert.ok(partners.includes('bindtap="openEncounters"'));
assert.ok(partnersJs.includes("deviceService.getEncounterRecords()"));
assert.ok(partners.includes("conversation-list"));
assert.ok(partners.includes("朋友"));
assert.ok(partners.includes("招呼"));
assert.ok(partners.indexOf("朋友") < partners.indexOf("招呼"));
assert.ok(partners.includes("notice-dot"));
assert.ok(partners.includes('bindtap="toggleSection"'));
assert.ok(partners.includes('catchtap="respondGreeting"'));
assert.ok(!partners.includes('data-view="messages"'));
assert.ok(!partners.includes('data-view="people"'));
assert.ok(partnersStyle.includes("font-size: 28rpx"), "伙伴页正文应使用适老化字号");
assert.ok(partnersStyle.includes("min-height: 132rpx"), "伙伴页主入口应有足够大的触控区域");

const encounters = read("miniprogram/pages/encounters/encounters.wxml");
assert.ok(!encounters.includes("查看收到的招呼与已认识伙伴"));
assert.ok(!encounters.includes("已经是伙伴，本次只记录相遇"));
assert.ok(encounters.includes("item.profile.avatarDisplayUrl"), "相遇记录应显示解析后的微信头像地址");

const socialProfileView = read("miniprogram/pages/social-profile/social-profile.wxml");
assert.ok(!socialProfileView.includes("只展示你主动填写的公开资料"));
assert.ok(!socialProfileView.includes("也可以使用虚拟形象"));
assert.ok(!socialProfileView.includes("最多选择 3 个"));
assert.ok(socialProfileView.includes("私密资料不会上传云端"));

const tabSwipe = read("miniprogram/utils/tab-swipe.js");
assert.ok(tabSwipe.includes("rubberBand(deltaX"), "边界滑动应使用渐进阻尼");
assert.ok(tabSwipe.includes("VELOCITY_PROJECTION_SECONDS"), "松手后应按滑动速度预测去向");
assert.ok(tabSwipe.includes("cubic-bezier(.2,.82,.2,1)"), "页面切换应使用平滑抽屉曲线");
assert.ok(tabSwipe.includes("softClamp(deltaX"), "页面长距离拖动应使用软边界，避免突然截停");
assert.ok(tabSwipe.includes("motionDuration("), "页面完成与回弹动画应根据距离和速度动态计算");
assert.ok(tabSwipe.includes("scale(${safeScale.toFixed(4)})"), "页面切换应有轻量深度变化");
[
  "device/device",
  "partners/partners"
].forEach(page => {
  const wxml = read(`miniprogram/pages/${page}.wxml`);
  assert.ok(wxml.includes('bindtouchstart="onTabSwipeStart"'), `${page} 应支持左右滑动`);
  assert.ok(wxml.includes('bindtouchmove="onTabSwipeMove"'), `${page} 应提供跟手动画`);
  assert.ok(wxml.includes('style="{{tabSwipeStyle}}"'), `${page} 应绑定滑动过渡样式`);
});
const aiChat = read("miniprogram/pages/chat/chat.wxml");
assert.ok(aiChat.includes("麦克风正常"));
assert.ok(aiChat.includes("扬声器正常"));
assert.ok(!aiChat.includes("或者"), "AI 聊天页不应保留多余的‘或者’分隔行");
assert.ok(!aiChat.includes("短按挂件 PTT 键"), "AI 聊天页不应堆叠固件操作说明");
assert.ok(!aiChat.includes("手机麦克风备用"), "AI 聊天页应保持硬件状态区精简");

const chat = read("miniprogram/pages/social-chat/social-chat.wxml");
const chatStyle = read("miniprogram/pages/social-chat/social-chat.wxss");
assert.ok(chat.includes('<input class="message-input"'));
assert.ok(chat.includes("contact-access-summary"));
assert.ok(!chat.includes("contact-panel"), "联系方式详情不应在聊天页占据大块高度");
assert.match(chatStyle, /\.contact-access \{[^}]*min-height: 100rpx/s);
assert.ok(!chatStyle.includes("height: 50vh"));
assert.ok(chatStyle.includes("flex: 0 0 64rpx"));
assert.ok(chatStyle.includes("flex: 0 0 124rpx"));
assert.ok(chatStyle.includes("flex: 1 1 0"));
assert.match(chatStyle, /\.bubble \{[^}]*font-size: 34rpx/s, "聊天气泡应使用适老化字号");
assert.match(chatStyle, /\.message-input \{[^}]*font-size: 32rpx/s, "聊天输入框应使用适老化字号");
assert.ok(device.includes('class="more-dot"'), "更多入口应使用紧凑的独立圆点");
assert.match(deviceStyle, /\.more-entry-icon \{[^}]*gap: 6rpx/s);

console.log("ui information architecture tests passed");

const config = require("./config/index");

App({
  onLaunch() {
    // Mock 和 HTTP 模式不初始化云开发，未创建云环境也能正常运行。
    if (!config.usesCloudBackend()) return;

    if (!config.cloudEnvId) {
      console.warn("云开发环境 ID 未填写，云函数暂不可用");
      return;
    }

    if (!wx.cloud || typeof wx.cloud.init !== "function") {
      console.error("当前基础库不支持微信云开发，请升级基础库版本");
      return;
    }

    // onLaunch 正常只执行一次，额外判断可避免热重载等场景重复初始化。
    if (this.globalData.cloudInitialized) return;

    try {
      wx.cloud.init({ env: config.cloudEnvId, traceUser: true });
      this.globalData.cloudInitialized = true;
    } catch (error) {
      this.globalData.cloudInitialized = false;
      console.error("微信云开发初始化失败", error);
    }
  },
  globalData: { appName: "云团", cloudInitialized: false }
});

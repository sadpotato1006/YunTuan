const deviceService = require("../../services/device");
const profileService = require("../../services/social-profile");
const settingsService = require("../../services/settings");
const dataPrivacyService = require("../../services/data-privacy");
const tabSwipe = require("../../utils/tab-swipe");
Page({
  data: {
    loading: true,
    operating: false,
    connectingDeviceId: "",
    discovering: false,
    available: false,
    statusText: "正在初始化蓝牙…",
    nearbyDevices: [],
    tabSwipeStyle: "",
    settings: settingsService.getSettings(),
    settingSaving: false,
    showPrivateTools: false,
    deletingCloudData: false,
    socialProfile: profileService.toPublicCard(profileService.getProfile()),
    device: {
      name: "云团智能挂件",
      connected: false,
      ready: false,
      battery: null,
      socialMode: false
    }
  },

  onLoad() {
    this.unsubscribe = deviceService.subscribe(state => {
      this.setData({
        discovering: state.discovering,
        available: state.available,
        statusText: state.statusText,
        nearbyDevices: state.devices || [],
        device: Object.assign({}, this.data.device, {
          id: state.deviceId,
          name: state.name,
          connected: state.connected,
          connecting: state.connecting,
          reconnecting: state.reconnecting,
          ready: state.ready,
          simulated: state.simulated,
          canReconnect: state.canReconnect,
          rememberedDeviceName: state.rememberedDeviceName,
          battery: state.battery,
          batteryStatus: state.batteryStatus,
          socialMode: state.socialMode,
          ownSocialToken: state.ownSocialToken,
          uptime: state.uptime,
          protocolMajor: state.protocolMajor,
          protocolMinor: state.protocolMinor,
          securityMode: state.securityMode,
          modelNumber: state.modelNumber,
          firmwareRevision: state.firmwareRevision,
          hardwareRevision: state.hardwareRevision,
          serialNumber: state.serialNumber,
          errorMessage: state.errorMessage,
          lastEventText: state.lastEventText
        })
      });
    });
  },

  async onShow() {
    tabSwipe.enter(this, "/pages/device/device");
    this.setData({
      socialProfile: profileService.toPublicCard(profileService.getProfile()),
      settings: settingsService.getSettings()
    });
    await this.initializeDevice();
    await this.loadDevice();
    deviceService.refreshSocialRegistration().catch(error => {
      console.warn("社交匿名令牌续期失败：", error && error.message);
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  async initializeDevice() {
    if (this.data.device.connected) return;
    try {
      await deviceService.initialize();
    } catch (error) {
      this.showError(error);
    }
  },

  onPullDownRefresh() {
    this.refreshStatus();
  },

  async loadDevice() {
    try {
      const result = await deviceService.getDevice();
      this.setData({
        device: result.data.device,
        loading: false
      });
    } catch (error) { this.showError(error); }
    finally { wx.stopPullDownRefresh(); }
  },

  async refreshStatus() {
    if (!this.data.device.ready) {
      await this.loadDevice();
      return;
    }
    try {
      const result = await deviceService.refreshStatus();
      this.setData({ device: result.data.device });
      wx.showToast({ title: "状态已刷新", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  async startScan() {
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      await deviceService.startScan();
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  async stopScan() {
    try { await deviceService.stopScan(); }
    catch (error) { this.showError(error); }
  },

  async connectDevice(event) {
    if (this.data.operating) return;
    const deviceId = event.currentTarget.dataset.deviceId;
    this.setData({ operating: true, connectingDeviceId: deviceId });
    try {
      const result = await deviceService.bindDevice(deviceId);
      this.setData({ device: result.data.device });
      wx.showToast({ title: "挂件连接成功", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false, connectingDeviceId: "" });
    }
  },

  async reconnectLastDevice() {
    if (this.data.device.reconnecting) {
      try {
        const result = await deviceService.cancelReconnectLastDevice();
        this.setData({ device: result.data.device, operating: false });
        wx.showToast({ title: "已停止重新连接", icon: "none" });
      } catch (error) {
        this.showError(error);
      }
      return;
    }
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      const result = await deviceService.reconnectLastDevice();
      this.setData({ device: result.data.device });
      wx.showToast({ title: "挂件重新连接成功", icon: "success" });
    } catch (error) {
      if (!error || !error.cancelled) this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  async toggleSocialMode(event) {
    if (!this.data.device.ready || this.data.operating) return;
    const enabled = event.detail.value;
    const previous = this.data.device.socialMode;
    this.setData({ operating: true });
    try {
      const result = await deviceService.setSocialMode(enabled);
      this.setData({ device: result.data.device });
    } catch (error) {
      this.setData({ "device.socialMode": previous });
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  async updateAlertSetting(event) {
    if (!this.data.device.ready || this.data.settingSaving) return;
    const key = String(event.currentTarget.dataset.key || "");
    if (!Object.prototype.hasOwnProperty.call(settingsService.DEFAULT_SETTINGS, key)) return;
    const previous = this.data.settings;
    const next = settingsService.normalizeSettings(Object.assign({}, previous, {
      [key]: event.detail.value
    }));
    this.setData({ settingSaving: true });
    try {
      const result = await deviceService.setAlertSettings(next);
      const settings = settingsService.saveSettings(result.data.settings || next);
      this.setData({ settings });
      wx.showToast({ title: "震动设置已同步", icon: "success" });
    } catch (error) {
      this.setData({ settings: previous });
      this.showError(error);
    } finally {
      this.setData({ settingSaving: false });
    }
  },

  async findDevice() {
    if (!this.data.device.ready || this.data.operating) return;
    this.setData({ operating: true });
    try {
      await deviceService.findDevice();
      wx.showToast({ title: "挂件正在提醒", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  disconnectDevice() {
    if (!this.data.device.connected || this.data.operating) return;
    wx.showModal({
      title: "断开挂件",
      content: "断开后将停止接收挂件消息。确定要断开吗？",
      confirmText: "断开",
      confirmColor: "#A85B50",
      success: result => { if (result.confirm) this.runDisconnectDevice(); }
    });
  },

  async runDisconnectDevice() {
    this.setData({ operating: true });
    try {
      const result = await deviceService.disconnectDevice();
      this.setData({ device: result.data.device });
      wx.showToast({ title: "挂件已断开", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  goDeveloperTools() { wx.navigateTo({ url: "/pages/device-lab/device-lab" }); },
  goSocialProfile() { wx.navigateTo({ url: "/pages/social-profile/social-profile" }); },
  togglePrivateTools() { this.setData({ showPrivateTools: !this.data.showPrivateTools }); },

  showPrivacy() {
    wx.showModal({
      title: "隐私说明",
      content: "AI 聊天文字会通过微信云函数发送给 AI 服务生成回复；挂件语音会发送给语音识别服务转换成文字，回复文字可能发送给语音合成服务。社交名片会同步到云数据库，相遇时仅展示头像、昵称、介绍、兴趣和社交意愿，不提供真实姓名、位置、设备身份或微信 OpenID。确认成为伙伴后，双方主动发送的消息会保存在云数据库中。联系方式预设只保存在当前设备，双方同意交换后，只有本人明确勾选的内容才会上传分享。最近相遇及公开名片快照保存在本机。您可以在这里清除缓存或删除全部个人数据。",
      showCancel: false,
      confirmText: "知道了"
    });
  },

  showAbout() {
    wx.showModal({
      title: "关于云团",
      content: "云团是一款面向随迁老人的温暖陪伴产品。\n当前版本：前端演示版 1.1.0",
      showCancel: false,
      confirmText: "好的"
    });
  },

  clearLocalData() {
    wx.showModal({
      title: "清除本机缓存",
      content: "这会清除本机聊天、相遇记录、设备连接信息、名片缓存、联系方式预设和应用设置；已经上传到云端的数据不会删除。确定继续吗？",
      confirmText: "清除",
      confirmColor: "#C06052",
      success: result => {
        if (!result.confirm) return;
        this.clearLocalStorage();
        wx.showToast({ title: "本机缓存已清除", icon: "success" });
      }
    });
  },

  deleteCloudData() {
    if (this.data.deletingCloudData) return;
    wx.showModal({
      title: "删除全部个人数据",
      content: "将永久删除云端 AI 聊天保护记录、社交名片与头像、已分享的联系方式、招呼、伙伴关系、聊天消息、屏蔽和举报记录，并同时清除本机数据。此操作无法撤销，确定继续吗？",
      confirmText: "永久删除",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.runDeleteCloudData(); }
    });
  },

  async runDeleteCloudData() {
    this.setData({ deletingCloudData: true });
    wx.showLoading({ title: "正在删除", mask: true });
    try {
      await dataPrivacyService.deleteCloudData();
      this.clearLocalStorage();
      const app = typeof getApp === "function" ? getApp() : null;
      if (app && typeof app.setSocialBadgeCount === "function") app.setSocialBadgeCount(0);
      wx.showToast({ title: "全部数据已删除", icon: "success" });
    } catch (error) {
      wx.showModal({
        title: "删除未完成",
        content: `${error.message || "云端数据删除失败"}。可以稍后再次删除。`,
        showCancel: false,
        confirmText: "知道了"
      });
    } finally {
      wx.hideLoading();
      this.setData({ deletingCloudData: false });
    }
  },

  clearLocalStorage() {
    const profile = profileService.getProfile();
    if (profile.avatarType === "custom" && profile.avatarValue &&
        typeof wx.removeSavedFile === "function") {
      wx.removeSavedFile({ filePath: profile.avatarValue, fail() {} });
    }
    deviceService.clearLocalPrivateState();
    wx.clearStorageSync();
    this.setData({
      socialProfile: profileService.toPublicCard(profileService.getProfile())
    });
  },
  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/device/device"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/device/device"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); },

  showError(error) {
    this.setData({ loading: false });
    wx.showToast({ title: error.message || "设备操作失败", icon: "none", duration: 2600 });
  }
});

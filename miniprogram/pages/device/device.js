const deviceService = require("../../services/device");
const profileService = require("../../services/social-profile");
const socialService = require("../../services/social");
const encounterStore = require("../../services/social-encounters");
const settingsService = require("../../services/settings");
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
    latestEncounter: null,
    settings: settingsService.getSettings(),
    settingSaving: false,
    socialProfile: profileService.toPublicCard(profileService.getProfile()),
    device: {
      name: "云团智能挂件",
      connected: false,
      ready: false,
      battery: null,
      socialMode: false,
      lastEncounterAt: 0,
      lastEncounterText: "",
      lastEncounterRssi: null,
      encounterCount: 0
    }
  },

  onLoad() {
    this.unsubscribe = deviceService.subscribe(state => {
      const latestEncounter = deviceService.getEncounterRecords()[0] || null;
      this.setData({
        discovering: state.discovering,
        available: state.available,
        statusText: state.statusText,
        nearbyDevices: state.devices || [],
        latestEncounter,
        device: Object.assign({}, this.data.device, {
          id: state.deviceId,
          name: state.name,
          connected: state.connected,
          connecting: state.connecting,
          ready: state.ready,
          simulated: state.simulated,
          canReconnect: state.canReconnect,
          rememberedDeviceName: state.rememberedDeviceName,
          battery: state.battery,
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
          lastEventText: state.lastEventText,
          lastEncounterAt: state.lastEncounterAt,
          lastEncounterId: state.lastEncounterId,
          lastEncounterText: state.lastEncounterText,
          lastEncounterTimeEstimated: state.lastEncounterTimeEstimated,
          lastEncounterRssi: state.lastEncounterRssi,
          encounterCount: state.encounterCount,
          lastEncounterProfile: state.lastEncounterProfile,
          encounterProfileLoading: state.encounterProfileLoading,
          encounterProfileMessage: state.encounterProfileMessage
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
        latestEncounter: deviceService.getEncounterRecords()[0] || null,
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
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      const result = await deviceService.reconnectLastDevice();
      this.setData({ device: result.data.device });
      wx.showToast({ title: "挂件重新连接成功", icon: "success" });
    } catch (error) {
      this.showError(error);
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
      wx.showToast({ title: "提醒设置已同步", icon: "success" });
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

  async retryEncounterProfile() {
    if (this.data.device.encounterProfileLoading) return;
    try {
      await deviceService.retryLastEncounterProfile();
    } catch (error) {
      this.showError(error);
    }
  },

  async greetLatestEncounter() {
    const latest = this.data.latestEncounter;
    if (!latest || !latest.interactionRef || this.data.operating) return;
    this.setData({ operating: true });
    try {
      const result = await socialService.sendGreeting(latest.interactionRef);
      const updated = encounterStore.markGreeting(
        latest.encounterId,
        result.matched ? "matched" : "sent"
      );
      this.setData({ latestEncounter: updated ? encounterStore.toDisplayRecord(updated) : latest });
      if (result.matched) {
        wx.showModal({
          title: "你们已经认识啦",
          content: "测试伙伴已经接受招呼，可以前往伙伴页开始聊天。",
          confirmText: "去聊天",
          cancelText: "稍后",
          success: modal => { if (modal.confirm) this.goSocialInbox(); }
        });
      } else {
        wx.showToast({ title: "招呼已发送", icon: "success" });
      }
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  goDeviceDetails() { wx.navigateTo({ url: "/pages/device-lab/device-lab" }); },
  goEncounters() { wx.navigateTo({ url: "/pages/encounters/encounters" }); },
  goSocialInbox() { wx.switchTab({ url: "/pages/partners/partners" }); },
  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/device/device"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/device/device"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); },

  showError(error) {
    this.setData({ loading: false });
    wx.showToast({ title: error.message || "设备操作失败", icon: "none", duration: 2600 });
  }
});

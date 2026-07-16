const deviceService = require("../../services/device");
const profileService = require("../../services/social-profile");
Page({
  data: {
    loading: true,
    operating: false,
    connectingDeviceId: "",
    discovering: false,
    available: false,
    statusText: "正在初始化蓝牙…",
    nearbyDevices: [],
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
          ready: state.ready,
          simulated: state.simulated,
          canReconnect: state.canReconnect,
          rememberedDeviceName: state.rememberedDeviceName,
          battery: state.battery,
          chargingState: state.chargingState,
          socialMode: state.socialMode,
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
          lastEncounterText: state.lastEncounterText,
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
    this.setData({ socialProfile: profileService.toPublicCard(profileService.getProfile()) });
    await this.initializeDevice();
    await this.loadDevice();
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
      this.setData({ device: result.data.device, loading: false });
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

  async loadSimulator() {
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      const result = await deviceService.loadSimulator();
      this.setData({ device: result.data.device });
      wx.showToast({ title: "模拟挂件已连接", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
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

  async pingDevice() {
    if (!this.data.device.ready || this.data.operating) return;
    this.setData({ operating: true });
    try {
      await deviceService.ping();
      wx.showToast({ title: "通信正常", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  goBleDebug() { wx.navigateTo({ url: "/pages/ble-debug/ble-debug" }); },

  disconnectDevice() {
    if (this.data.operating) return;
    wx.showModal({
      title: "断开设备",
      content: "断开后将暂时无法接收挂件状态，确定继续吗？",
      confirmText: "断开",
      confirmColor: "#C06052",
      success: result => {
        if (result.confirm) this.runDisconnect();
      }
    });
  },

  async runDisconnect() {
    this.setData({ operating: true });
    try {
      const result = await deviceService.disconnectDevice();
      this.setData({ device: result.data.device });
      wx.showToast({ title: "设备已断开", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  showError(error) {
    this.setData({ loading: false });
    wx.showToast({ title: error.message || "设备操作失败", icon: "none", duration: 2600 });
  }
});

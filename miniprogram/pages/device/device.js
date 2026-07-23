const deviceService = require("../../services/device");
const profileService = require("../../services/social-profile");
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
      socialProfile: profileService.toPublicCard(profileService.getProfile())
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

  goMore() { wx.navigateTo({ url: "/pages/more/more" }); },
  goSocialProfile() { wx.navigateTo({ url: "/pages/social-profile/social-profile" }); },
  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/device/device"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/device/device"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); },

  showError(error) {
    this.setData({ loading: false });
    wx.showToast({ title: error.message || "设备操作失败", icon: "none", duration: 2600 });
  }
});

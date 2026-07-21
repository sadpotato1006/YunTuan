const deviceService = require("../../services/device");
const socialService = require("../../services/social");
const diagnostics = require("../../services/diagnostics");

Page({
  data: {
    operating: false,
    diagnosticCount: diagnostics.getEvents().length,
    device: {
      connected: false,
      ready: false,
      simulated: false,
      socialMode: false,
      ownSocialToken: 0
    }
  },

  onLoad() {
    this.unsubscribe = deviceService.subscribe(state => {
      this.setData({
        device: Object.assign({}, this.data.device, {
          connected: state.connected,
          ready: state.ready,
          simulated: state.simulated,
          socialMode: state.socialMode,
          ownSocialToken: state.ownSocialToken,
          protocolMajor: state.protocolMajor,
          protocolMinor: state.protocolMinor,
          battery: state.battery,
          name: state.name,
          modelNumber: state.modelNumber,
          firmwareRevision: state.firmwareRevision,
          hardwareRevision: state.hardwareRevision,
          serialNumber: state.serialNumber,
          securityMode: state.securityMode,
          statusText: state.statusText,
          errorMessage: state.errorMessage
        })
      });
    });
  },

  async onShow() {
    try {
      await deviceService.initialize();
      const result = await deviceService.getDevice();
      this.setData({
        device: Object.assign({}, this.data.device, result.data.device),
        diagnosticCount: diagnostics.getEvents().length
      });
    } catch (error) {
      this.showError(error);
    }
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
  },

  async loadSimulator() {
    if (this.data.operating || (this.data.device.connected && !this.data.device.simulated)) {
      if (this.data.device.connected && !this.data.device.simulated) {
        wx.showToast({ title: "请先在设备页断开真实挂件", icon: "none" });
      }
      return;
    }
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

  async startSoloSocialTest() {
    if (!this.canUseSimulator()) return;
    this.setData({ operating: true });
    try {
      const partner = await socialService.prepareSoloTestPartner();
      await deviceService.simulateSocialEncounter(partner.token, -55);
      wx.showModal({
        title: "测试伙伴已出现",
        content: "返回设备页即可在“最近相遇”卡片直接打招呼。测试伙伴会自动接受。",
        confirmText: "返回设备页",
        cancelText: "继续调试",
        success: result => { if (result.confirm) wx.navigateBack(); }
      });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  copySimulatorToken() {
    const token = Number(this.data.device.ownSocialToken) >>> 0;
    if (!token) {
      wx.showToast({ title: "模拟 Token 尚未就绪", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: String(token),
      success: () => wx.showToast({ title: "Token 已复制", icon: "success" })
    });
  },

  async registerSimulatorToken() {
    if (!this.canUseSimulator()) return;
    this.setData({ operating: true });
    try {
      await deviceService.refreshSocialRegistration();
      wx.showToast({ title: "Token 已重新登记", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  promptSimulatorEncounter() {
    if (!this.canUseSimulator()) return;
    wx.showModal({
      title: "模拟遇见另一个账号",
      content: "输入对方开发调试页显示的模拟 Token。",
      editable: true,
      placeholderText: "例如 305419896",
      confirmText: "模拟相遇",
      success: result => {
        if (!result.confirm) return;
        try {
          this.simulateEncounter(parseSimulatorToken(result.content));
        } catch (error) {
          this.showError(error);
        }
      }
    });
  },

  async simulateEncounter(peerToken) {
    this.setData({ operating: true });
    try {
      await deviceService.simulateSocialEncounter(peerToken, -55);
      wx.showToast({ title: "相遇事件已注入", icon: "success" });
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
      wx.showToast({ title: "控制通信正常", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  disconnectDevice() {
    if (!this.data.device.connected || this.data.operating) return;
    wx.showModal({
      title: "断开设备",
      content: "断开后将停止接收挂件状态与相遇事件，确定继续吗？",
      confirmText: "断开",
      confirmColor: "#C06052",
      success: result => { if (result.confirm) this.runDisconnect(); }
    });
  },

  async runDisconnect() {
    this.setData({ operating: true });
    try {
      const result = await deviceService.disconnectDevice();
      this.setData({ device: Object.assign({}, this.data.device, result.data.device) });
      wx.showToast({ title: "设备已断开", icon: "success" });
    } catch (error) {
      this.showError(error);
    } finally {
      this.setData({ operating: false });
    }
  },

  canUseSimulator() {
    if (this.data.operating) return false;
    if (!this.data.device.ready || !this.data.device.simulated) {
      wx.showToast({ title: "请先加载模拟挂件", icon: "none" });
      return false;
    }
    if (!this.data.device.socialMode) {
      wx.showToast({ title: "请先在设备页开启社交模式", icon: "none" });
      return false;
    }
    return true;
  },

  goBleDebug() { wx.navigateTo({ url: "/pages/ble-debug/ble-debug" }); },

  copyDiagnosticReport() {
    const report = diagnostics.buildReport(this.data.device);
    wx.setClipboardData({
      data: report,
      success: () => wx.showToast({ title: "诊断报告已复制", icon: "success" })
    });
  },

  clearDiagnosticReport() {
    wx.showModal({
      title: "清空诊断记录",
      content: "只会清除本机诊断事件，不影响聊天、情绪或社交数据。",
      confirmText: "清空",
      confirmColor: "#C06052",
      success: result => {
        if (!result.confirm) return;
        diagnostics.clear();
        this.setData({ diagnosticCount: 0 });
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  },

  showError(error) {
    wx.showToast({ title: error.message || "调试操作失败", icon: "none", duration: 2600 });
  }
});

function parseSimulatorToken(value) {
  const text = String(value || "").trim();
  const token = /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text.slice(2), 16) : Number(text);
  if (!Number.isInteger(token) || token <= 0 || token > 0xFFFFFFFF) {
    throw new Error("请输入正确的模拟 Token");
  }
  return token >>> 0;
}

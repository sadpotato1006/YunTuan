const deviceService = require("../../services/device");
Page({
  data: { loading: true, operating: false, device: {} },
  onShow() { this.loadDevice(); },
  onPullDownRefresh() { this.loadDevice(); },
  async loadDevice() {
    try {
      const result = await deviceService.getDevice();
      this.setData({ device: result.data.device, loading: false });
    } catch (error) { this.showError(error); }
    finally { wx.stopPullDownRefresh(); }
  },
  async toggleSocialMode(event) {
    const enabled = event.detail.value;
    this.setData({ "device.socialMode": enabled });
    try { await deviceService.setSocialMode(enabled); }
    catch (error) { this.setData({ "device.socialMode": !enabled }); this.showError(error); }
  },
  async bindDevice() { await this.runDeviceAction(deviceService.bindDevice, "设备绑定成功"); },
  goBleDebug() { wx.navigateTo({ url: "/pages/ble-debug/ble-debug" }); },
  disconnectDevice() {
    if (this.data.operating) return;
    wx.showModal({
      title: "断开设备",
      content: "断开后将暂时无法接收挂件状态，确定继续吗？",
      confirmText: "断开",
      confirmColor: "#C06052",
      success: result => {
        if (result.confirm) this.runDeviceAction(deviceService.disconnectDevice, "设备已断开");
      }
    });
  },
  async runDeviceAction(action, successText) {
    if (this.data.operating) return;
    this.setData({ operating: true });
    try {
      // 页面只调用 service；后续 BLE 连接逻辑集中封装在 device service。
      const result = await action();
      this.setData({ device: result.data.device, operating: false });
      wx.showToast({ title: successText, icon: "success" });
    } catch (error) { this.setData({ operating: false }); this.showError(error); }
  },
  showError(error) { this.setData({ loading: false }); wx.showToast({ title: error.message || "设备操作失败", icon: "none" }); }
});

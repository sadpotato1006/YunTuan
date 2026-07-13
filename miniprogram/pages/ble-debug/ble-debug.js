const bleService = require("../../services/ble");

Page({
  data: {
    bleState: {},
    displayDevices: [],
    onlyYuntuan: false,
    writePanel: {
      visible: false,
      serviceId: "",
      characteristicId: "",
      characteristicName: "",
      hexValue: "",
      writeType: "write",
      writeTypes: []
    }
  },

  onLoad() {
    this.unsubscribe = bleService.subscribe(bleState => {
      this.setData({
        bleState,
        displayDevices: bleService.getDisplayDevices(this.data.onlyYuntuan)
      });
    });
  },

  onUnload() {
    if (this.unsubscribe) this.unsubscribe();
    bleService.dispose({ disconnect: true, closeAdapter: false });
  },

  async initialize() {
    try { await bleService.initialize(); }
    catch (error) { this.showError(error); }
  },

  async loadSimulator() {
    try {
      await bleService.loadSimulator();
      wx.showToast({ title: "模拟设备已加载", icon: "success" });
    } catch (error) { this.showError(error); }
  },

  async startScan() {
    try { await bleService.startScan(); }
    catch (error) { this.showError(error); }
  },

  async stopScan() {
    try { await bleService.stopScan(); }
    catch (error) { this.showError(error); }
  },

  toggleFilter(event) {
    const onlyYuntuan = event.detail.value;
    this.setData({ onlyYuntuan, displayDevices: bleService.getDisplayDevices(onlyYuntuan) });
  },

  async connectDevice(event) {
    if (this.data.bleState.connecting) return;
    try {
      await bleService.connectDevice(event.currentTarget.dataset.deviceId);
      wx.showToast({ title: "连接成功", icon: "success" });
    } catch (error) { this.showError(error); }
  },

  async disconnectDevice() {
    try {
      await bleService.disconnectDevice();
      wx.showToast({ title: "设备已断开", icon: "success" });
    } catch (error) { this.showError(error); }
  },

  async readCharacteristic(event) {
    const data = event.currentTarget.dataset;
    try {
      await bleService.readCharacteristic(data.serviceId, data.characteristicId);
      wx.showToast({ title: "读取请求已发送", icon: "none" });
    } catch (error) { this.showError(error); }
  },

  async toggleNotify(event) {
    const data = event.currentTarget.dataset;
    const enabled = data.subscribed !== true && data.subscribed !== "true";
    try {
      await bleService.setCharacteristicNotify(data.serviceId, data.characteristicId, enabled);
      wx.showToast({ title: enabled ? "订阅成功" : "已取消订阅", icon: "success" });
    } catch (error) { this.showError(error); }
  },

  openWritePanel(event) {
    const data = event.currentTarget.dataset;
    const characteristic = this.findCharacteristic(data.serviceId, data.characteristicId);
    if (!characteristic) {
      this.showError(new Error("没有找到这个特征值"));
      return;
    }

    const writeTypes = [];
    if (characteristic.properties.write) writeTypes.push({ label: "Write（有响应）", value: "write" });
    if (characteristic.properties.writeNoResponse) {
      writeTypes.push({ label: "WriteNoResponse（无响应）", value: "writeNoResponse" });
    }
    this.setData({
      writePanel: {
        visible: true,
        serviceId: data.serviceId,
        characteristicId: data.characteristicId,
        characteristicName: characteristic.displayName,
        hexValue: "",
        writeType: writeTypes[0].value,
        writeTypes
      }
    });
  },

  closeWritePanel() {
    this.setData({ "writePanel.visible": false });
  },

  preventClose() {},

  onHexInput(event) {
    this.setData({ "writePanel.hexValue": event.detail.value });
  },

  onWriteTypeChange(event) {
    this.setData({ "writePanel.writeType": event.detail.value });
  },

  async sendHexData() {
    const panel = this.data.writePanel;
    try {
      await bleService.writeCharacteristic(
        panel.serviceId,
        panel.characteristicId,
        panel.hexValue,
        panel.writeType
      );
      this.closeWritePanel();
      wx.showToast({ title: "写入成功", icon: "success" });
    } catch (error) { this.showError(error); }
  },

  findCharacteristic(serviceId, characteristicId) {
    const normalize = value => String(value || "").replace(/-/g, "").toUpperCase();
    const service = (this.data.bleState.services || []).find(item => normalize(item.uuid) === normalize(serviceId));
    if (!service) return null;
    return service.characteristics.find(item => normalize(item.uuid) === normalize(characteristicId)) || null;
  },

  copyUuid(event) {
    wx.setClipboardData({ data: event.currentTarget.dataset.uuid });
  },

  copyLogs() {
    wx.setClipboardData({
      data: bleService.getLogText(),
      success() { wx.showToast({ title: "日志已复制", icon: "success" }); }
    });
  },

  clearLogs() {
    bleService.clearLogs();
    wx.showToast({ title: "日志已清空", icon: "none" });
  },

  showError(error) {
    wx.showToast({ title: error.message || "蓝牙操作失败", icon: "none", duration: 2500 });
  }
});

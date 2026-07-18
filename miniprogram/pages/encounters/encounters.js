const deviceService = require("../../services/device");
const socialService = require("../../services/social");
const encounterStore = require("../../services/social-encounters");

Page({
  data: {
    records: [],
    loading: true,
    operatingId: ""
  },

  onShow() { this.loadRecords(); },

  loadRecords() {
    const records = deviceService.getEncounterRecords().map(record => Object.assign({}, record, {
      timeText: formatTime(record.occurredAt, record.timeEstimated)
    }));
    this.setData({ records, loading: false });
  },

  async retryProfile(event) {
    const encounterId = event.currentTarget.dataset.id;
    if (!encounterId || this.data.operatingId) return;
    this.setData({ operatingId: encounterId });
    try {
      await deviceService.retryEncounterProfile(encounterId);
      this.loadRecords();
    } catch (error) {
      wx.showToast({ title: error.message || "名片获取失败", icon: "none" });
    } finally {
      this.setData({ operatingId: "" });
    }
  },

  async sendGreeting(event) {
    const encounterId = event.currentTarget.dataset.id;
    const record = encounterStore.getRecord(encounterId);
    if (!record || !record.interactionRef || this.data.operatingId) {
      wx.showToast({ title: "这次相遇暂时无法发送招呼", icon: "none" });
      return;
    }
    this.setData({ operatingId: encounterId });
    try {
      const result = await socialService.sendGreeting(record.interactionRef);
      encounterStore.markGreeting(encounterId, result.matched ? "matched" : "sent");
      this.loadRecords();
      wx.showToast({
        title: result.matched ? "你们已经互相认识啦" : "招呼已发送",
        icon: "success"
      });
    } catch (error) {
      wx.showToast({ title: error.message || "招呼发送失败", icon: "none", duration: 2800 });
    } finally {
      this.setData({ operatingId: "" });
    }
  },

  goInbox() { wx.switchTab({ url: "/pages/partners/partners" }); }
});

function formatTime(timestamp, estimated) {
  const date = new Date(Number(timestamp) || Date.now());
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const dateText = `${sameYear ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
  const timeText = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${dateText} ${timeText}${estimated ? "（约）" : ""}`;
}

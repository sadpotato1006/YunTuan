const deviceService = require("../../services/device");
const socialService = require("../../services/social");
const encounterStore = require("../../services/social-encounters");
const socialAvatar = require("../../services/social-avatar");

Page({
  data: {
    records: [],
    loading: true,
    operatingId: ""
  },

  onShow() { this.loadRecords(); },

  loadRecords() {
    const records = deviceService.getEncounterRecords().map(record => Object.assign({}, record, {
      profile: record.profile ? socialAvatar.toDisplayProfile(record.profile) : null,
      avatarFailed: false,
      avatarRefreshAttempted: false,
      timeText: formatTime(record.occurredAt, record.timeEstimated)
    }));
    this.setData({ records, loading: false });
    records.forEach(record => {
      if (record.profile && record.profile.avatarType === "custom") {
        this.resolveAvatar(record.encounterId, record.profile);
      }
    });
  },

  async resolveAvatar(encounterId, profileValue, force) {
    const expectedValue = String(profileValue && profileValue.avatarValue || "");
    if (!encounterId || !expectedValue) return;
    try {
      const profile = await socialAvatar.resolveDisplayProfile(profileValue, { force: force === true });
      this.updateAvatar(encounterId, expectedValue, {
        avatarDisplayUrl: profile.avatarDisplayUrl,
        avatarFallback: profile.avatarFallback,
        avatarFailed: false
      });
    } catch (error) {
      console.warn("相遇记录头像地址解析失败：", error && error.message);
      this.updateAvatar(encounterId, expectedValue, { avatarFailed: true });
    }
  },

  updateAvatar(encounterId, expectedValue, values) {
    const index = this.data.records.findIndex(record => record.encounterId === encounterId);
    const current = index >= 0 ? this.data.records[index] : null;
    if (!current || String(current.profile && current.profile.avatarValue || "") !== expectedValue) return;
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(values, "avatarDisplayUrl")) {
      updates[`records[${index}].profile.avatarDisplayUrl`] = values.avatarDisplayUrl;
    }
    if (Object.prototype.hasOwnProperty.call(values, "avatarFallback")) {
      updates[`records[${index}].profile.avatarFallback`] = values.avatarFallback;
    }
    updates[`records[${index}].avatarFailed`] = values.avatarFailed === true;
    this.setData(updates);
  },

  handleAvatarError(event) {
    const encounterId = String(event.currentTarget.dataset.id || "");
    const record = this.data.records.find(item => item.encounterId === encounterId);
    const profile = record && record.profile;
    if (!profile) return;
    if (socialAvatar.isCloudFileId(profile.avatarValue) && !record.avatarRefreshAttempted) {
      this.setData({ [`records[${this.data.records.indexOf(record)}].avatarRefreshAttempted`]: true });
      this.resolveAvatar(encounterId, profile, true);
      return;
    }
    this.updateAvatar(encounterId, String(profile.avatarValue || ""), { avatarFailed: true });
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
    if (record && record.alreadyKnown) {
      wx.showToast({ title: "已经是伙伴，不需要再打招呼", icon: "none" });
      return;
    }
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
  }
});

function formatTime(timestamp, estimated) {
  const date = new Date(Number(timestamp) || Date.now());
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const dateText = `${sameYear ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日`;
  const timeText = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${dateText} ${timeText}${estimated ? "（约）" : ""}`;
}

const profileService = require("../../services/social-profile");
const socialService = require("../../services/social");
const yuntuanDevice = require("../../services/yuntuan-device");

const VIRTUAL_AVATARS = [
  { value: "☁️", color: "#DFECE5" },
  { value: "🌻", color: "#FFF0C7" },
  { value: "🐳", color: "#DDECF5" },
  { value: "🐱", color: "#F7E1D7" },
  { value: "🌙", color: "#E6E2F4" },
  { value: "🍀", color: "#DCEFD8" }
];

const AVAILABLE_TAGS = ["摄影", "羽毛球", "音乐", "跑步", "电影", "阅读", "旅行", "美食", "游戏", "宠物"];
const INTENTIONS = [
  { value: "chat", label: "可以聊天", description: "愿意认识附近的新朋友" },
  { value: "buddy", label: "找搭子", description: "寻找兴趣相同的活动伙伴" },
  { value: "quiet", label: "暂不打扰", description: "展示名片，但暂时不接收招呼" }
];

function buildTagOptions(tags) {
  const selected = Array.isArray(tags) ? tags : [];
  return AVAILABLE_TAGS.map(label => ({ label, selected: selected.includes(label) }));
}

const INITIAL_PROFILE = profileService.getProfile();

Page({
  data: {
    profile: INITIAL_PROFILE,
    virtualAvatars: VIRTUAL_AVATARS,
    tagOptions: buildTagOptions(INITIAL_PROFILE.tags),
    intentions: INTENTIONS,
    intentionLabel: profileService.INTENTION_LABELS[INITIAL_PROFILE.intention],
    customTag: "",
    saved: false,
    saving: false,
    greetingSent: false
  },

  onShow() {
    const profile = profileService.getProfile();
    this._savedProfile = profile;
    this.setData({
      profile,
      tagOptions: buildTagOptions(profile.tags),
      intentionLabel: profileService.INTENTION_LABELS[profile.intention],
      saved: false,
      greetingSent: false
    });
  },

  onUnload() {
    const profile = this.data.profile;
    if (profile.avatarType === "custom" &&
        (!this._savedProfile || profile.avatarValue !== this._savedProfile.avatarValue)) {
      this.removeAvatarFile(profile.avatarValue);
    }
  },

  removeAvatarFile(filePath) {
    if (!filePath || typeof wx.removeSavedFile !== "function") return;
    wx.removeSavedFile({ filePath, fail() {} });
  },

  selectVirtualAvatar(event) {
    const index = Number(event.currentTarget.dataset.index);
    const avatar = VIRTUAL_AVATARS[index];
    if (!avatar) return;
    const current = this.data.profile;
    if (current.avatarType === "custom" &&
        (!this._savedProfile || current.avatarValue !== this._savedProfile.avatarValue)) {
      this.removeAvatarFile(current.avatarValue);
    }
    this.setData({
      "profile.avatarType": "virtual",
      "profile.avatarValue": avatar.value,
      "profile.avatarColor": avatar.color,
      "profile.avatarCloudFileId": "",
      saved: false
    });
  },

  chooseAvatar(event) {
    const tempFilePath = event.detail && event.detail.avatarUrl;
    if (!tempFilePath) return;
    wx.saveFile({
      tempFilePath,
      success: result => {
        const previousUnsavedPath = this.data.profile.avatarType === "custom"
          ? this.data.profile.avatarValue
          : "";
        if (previousUnsavedPath &&
            (!this._savedProfile || previousUnsavedPath !== this._savedProfile.avatarValue)) {
          this.removeAvatarFile(previousUnsavedPath);
        }
        this.setData({
          "profile.avatarType": "custom",
          "profile.avatarValue": result.savedFilePath,
          "profile.avatarCloudFileId": "",
          saved: false
        });
      },
      fail: () => wx.showToast({ title: "头像保存失败，请重试", icon: "none" })
    });
  },

  inputNickname(event) {
    this.setData({ "profile.nickname": event.detail.value, saved: false });
  },

  inputBio(event) {
    this.setData({ "profile.bio": event.detail.value, saved: false });
  },

  toggleTag(event) {
    const tag = event.currentTarget.dataset.tag;
    const tags = this.data.profile.tags.slice();
    const index = tags.indexOf(tag);
    if (index >= 0) {
      tags.splice(index, 1);
    } else if (tags.length >= 3) {
      wx.showToast({ title: "最多选择 3 个标签", icon: "none" });
      return;
    } else {
      tags.push(tag);
    }
    this.setData({ "profile.tags": tags, tagOptions: buildTagOptions(tags), saved: false });
  },

  inputCustomTag(event) {
    this.setData({ customTag: event.detail.value });
  },

  addCustomTag() {
    const tag = String(this.data.customTag || "").trim().replace(/\s+/g, " ").slice(0, 8);
    if (!tag) return;
    if (this.data.profile.tags.includes(tag)) {
      this.setData({ customTag: "" });
      return;
    }
    if (this.data.profile.tags.length >= 3) {
      wx.showToast({ title: "最多选择 3 个标签", icon: "none" });
      return;
    }
    const tags = this.data.profile.tags.concat(tag);
    this.setData({
      "profile.tags": tags,
      tagOptions: buildTagOptions(tags),
      customTag: "",
      saved: false
    });
  },

  selectIntention(event) {
    const intention = event.currentTarget.dataset.value;
    if (!profileService.INTENTION_LABELS[intention]) return;
    this.setData({
      "profile.intention": intention,
      intentionLabel: profileService.INTENTION_LABELS[intention],
      saved: false,
      greetingSent: false
    });
  },

  async saveProfile() {
    if (this.data.saving) return;
    const nickname = String(this.data.profile.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    const oldSavedProfile = this._savedProfile;
    let profile = profileService.saveProfile(this.data.profile);
    if (oldSavedProfile && oldSavedProfile.avatarType === "custom" &&
        oldSavedProfile.avatarValue !== profile.avatarValue) {
      this.removeAvatarFile(oldSavedProfile.avatarValue);
    }
    this._savedProfile = profile;
    this.setData({
      profile,
      intentionLabel: profileService.INTENTION_LABELS[profile.intention],
      saved: false,
      saving: true
    });
    try {
      const synced = await socialService.saveProfile(profile);
      profile = profileService.saveProfile(synced.localProfile);
      this._savedProfile = profile;
      this.setData({ profile, saved: true });
      await yuntuanDevice.refreshSocialRegistration();
      wx.showToast({ title: "名片已同步云端", icon: "success" });
    } catch (error) {
      wx.showModal({
        title: "云端同步失败",
        content: `名片已保存在本机，但暂时无法让附近伙伴看到。${error.message || "请稍后重试"}`,
        showCancel: false,
        confirmText: "知道了"
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  sendGreeting() {
    if (this.data.profile.intention === "quiet") {
      wx.showToast({ title: "对方现在暂不接收招呼", icon: "none" });
      return;
    }
    this.setData({ greetingSent: true });
    wx.showToast({ title: "名片交互预览", icon: "none" });
  }
});

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
    saving: false
  },

  onShow() {
    const profile = profileService.getProfile();
    this._savedProfile = profile;
    this.setData({
      profile,
      tagOptions: buildTagOptions(profile.tags),
      intentionLabel: profileService.INTENTION_LABELS[profile.intention],
      saved: false
    });
    this.restoreCloudProfileIfNeeded(profile);
  },

  async restoreCloudProfileIfNeeded(localProfile) {
    if (this._cloudProfileChecked) return;
    this._cloudProfileChecked = true;
    try {
      const cloudProfile = await socialService.getMyProfile();
      if (!cloudProfile) return;
      const legacyContactOptions = Array.isArray(cloudProfile.legacyContactOptions)
        ? cloudProfile.legacyContactOptions
        : [];
      if (legacyContactOptions.length) {
        const sourceContacts = localProfile.contactOptions.length
          ? localProfile.contactOptions
          : legacyContactOptions;
        const baseProfile = localProfile.updatedAt > 0
          ? profileService.normalizeProfile(Object.assign({}, localProfile, { contactOptions: sourceContacts }))
          : profileService.fromCloudProfile(Object.assign({}, cloudProfile, { contactOptions: sourceContacts }));
        let profile = await socialService.localizeContactOptions(baseProfile);
        profile = profileService.saveProfile(profile);
        this._savedProfile = profile;
        this.setData({
          profile,
          tagOptions: buildTagOptions(profile.tags),
          intentionLabel: profileService.INTENTION_LABELS[profile.intention]
        });
        const synced = await socialService.saveProfile(profile);
        profile = profileService.saveProfile(synced.localProfile);
        this._savedProfile = profile;
        this.setData({ profile });
        return;
      }
      if (localProfile.updatedAt > 0 || this.data.profile.updatedAt > 0) return;
      const profile = profileService.saveProfile(profileService.fromCloudProfile(cloudProfile));
      this._savedProfile = profile;
      this.setData({
        profile,
        tagOptions: buildTagOptions(profile.tags),
        intentionLabel: profileService.INTENTION_LABELS[profile.intention]
      });
    } catch (error) {
      console.warn("云端社交名片恢复失败：", error && error.message);
    }
  },

  onUnload() {
    const profile = this.data.profile;
    if (profile.avatarType === "custom" &&
        (!this._savedProfile || profile.avatarValue !== this._savedProfile.avatarValue)) {
      this.removeAvatarFile(profile.avatarValue);
    }
    this.removeContactQrFilesNotInProfile(profile, this._savedProfile);
  },

  removeAvatarFile(filePath) {
    if (!filePath || typeof wx.removeSavedFile !== "function") return;
    wx.removeSavedFile({ filePath, fail() {} });
  },

  removeContactQrFilesNotInProfile(sourceProfile, retainedProfile) {
    const retainedPaths = new Set((retainedProfile && retainedProfile.contactOptions || [])
      .map(option => option && option.localPath)
      .filter(Boolean));
    (sourceProfile && sourceProfile.contactOptions || []).forEach(option => {
      if (option && option.localPath && !retainedPaths.has(option.localPath)) {
        this.removeAvatarFile(option.localPath);
      }
    });
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
      saved: false
    });
  },

  addContactOption(event) {
    const options = this.data.profile.contactOptions.slice();
    if (options.length >= 8) {
      wx.showToast({ title: "最多保存 8 条分享资料", icon: "none" });
      return;
    }
    const option = profileService.createContactOption(event.currentTarget.dataset.type);
    options.push(option);
    this.setData({ "profile.contactOptions": options, saved: false });
  },

  inputContactOption(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = String(event.currentTarget.dataset.field || "");
    if (!Number.isInteger(index) || index < 0 || !["label", "value"].includes(field)) return;
    this.setData({
      [`profile.contactOptions[${index}].${field}`]: String(event.detail.value || ""),
      saved: false
    });
  },

  chooseContactQr(event) {
    const index = Number(event.currentTarget.dataset.index);
    const option = this.data.profile.contactOptions[index];
    if (!option || option.type !== "qr") return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: async result => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.tempFilePath) return;
        try {
          const localPath = await socialService.saveContactQrLocally(file.tempFilePath);
          this.setData({
            [`profile.contactOptions[${index}].localPath`]: localPath,
            [`profile.contactOptions[${index}].qrCodeFileId`]: "",
            saved: false
          });
        } catch (error) {
          wx.showToast({ title: error.message || "二维码保存失败", icon: "none" });
        }
      }
    });
  },

  previewContactQr(event) {
    const index = Number(event.currentTarget.dataset.index);
    const option = this.data.profile.contactOptions[index];
    const source = option && (option.localPath || option.qrCodeFileId);
    if (source) wx.previewImage({ urls: [source], current: source });
  },

  removeContactOption(event) {
    const index = Number(event.currentTarget.dataset.index);
    const options = this.data.profile.contactOptions.slice();
    if (!options[index]) return;
    options.splice(index, 1);
    this.setData({ "profile.contactOptions": options, saved: false });
  },

  async saveProfile() {
    if (this.data.saving) return;
    const nickname = String(this.data.profile.nickname || "").trim();
    if (!nickname) {
      wx.showToast({ title: "请填写昵称", icon: "none" });
      return;
    }
    const contactError = validateContactOptions(this.data.profile.contactOptions);
    if (contactError) {
      wx.showToast({ title: contactError, icon: "none" });
      return;
    }
    const oldSavedProfile = this._savedProfile;
    let profile = profileService.saveProfile(this.data.profile);
    if (oldSavedProfile && oldSavedProfile.avatarType === "custom" &&
        oldSavedProfile.avatarValue !== profile.avatarValue) {
      this.removeAvatarFile(oldSavedProfile.avatarValue);
    }
    this.removeContactQrFilesNotInProfile(oldSavedProfile, profile);
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
      await yuntuanDevice.refreshSocialRegistration(true);
      wx.showToast({ title: "名片已同步，私密资料仅存本机", icon: "none" });
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
  }
});

function validateContactOptions(options) {
  const list = Array.isArray(options) ? options : [];
  for (let index = 0; index < list.length; index += 1) {
    const option = list[index] || {};
    const name = String(option.label || "").trim() || `第 ${index + 1} 条资料`;
    if (!String(option.label || "").trim()) return `请填写${name}的名称`;
    if (option.type === "qr") {
      if (!option.localPath && !option.qrCodeFileId) return `请为${name}选择二维码`;
      continue;
    }
    const value = String(option.value || "").trim();
    if (!value) return `请填写${name}`;
    if (option.type === "wechat" && (!/^[^\s]{5,32}$/.test(value) || /https?:\/\//i.test(value))) {
      return `${name}格式不正确`;
    }
    if (option.type === "phone") {
      const digits = value.replace(/\D/g, "");
      if (!/^\+?[0-9-]{6,20}$/.test(value) || digits.length < 6 || digits.length > 15) {
        return `${name}格式不正确`;
      }
    }
  }
  return "";
}

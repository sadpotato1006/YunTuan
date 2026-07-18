const STORAGE_KEY = "yuntuan_social_profile_v1";

const DEFAULT_PROFILE = Object.freeze({
  avatarType: "virtual",
  avatarValue: "☁️",
  avatarColor: "#DFECE5",
  avatarCloudFileId: "",
  nickname: "云团朋友",
  bio: "很高兴在云团遇见你",
  tags: [],
  intention: "chat",
  contactOptions: [],
  updatedAt: 0
});

const INTENTION_LABELS = Object.freeze({
  chat: "可以聊天",
  buddy: "找搭子",
  quiet: "暂不打扰"
});

function normalizeText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizeFileValue(value) {
  return String(value || "").trim().slice(0, 512);
}

function createContactOptionId() {
  const random = Math.random().toString(36).slice(2, 10);
  return `contact_${Date.now().toString(36)}_${random}`;
}

function normalizeContactOptions(value) {
  return (Array.isArray(value) ? value : []).slice(0, 8).map(item => {
    const source = item && typeof item === "object" ? item : {};
    const type = ["wechat", "phone", "qr"].includes(source.type) ? source.type : "wechat";
    const defaultLabel = type === "wechat" ? "微信号" : (type === "phone" ? "手机号" : "联系二维码");
    const id = /^[A-Za-z0-9_-]{8,64}$/.test(source.id || "")
      ? source.id
      : createContactOptionId();
    const option = {
      id,
      type,
      label: normalizeText(source.label, 12) || defaultLabel
    };
    if (type === "qr") {
      option.qrCodeFileId = normalizeFileValue(source.qrCodeFileId);
      option.localPath = normalizeFileValue(source.localPath);
    } else {
      option.value = String(source.value || "").trim().slice(0, type === "wechat" ? 32 : 20);
    }
    return option;
  });
}

function createContactOption(typeValue) {
  const type = ["wechat", "phone", "qr"].includes(typeValue) ? typeValue : "wechat";
  return normalizeContactOptions([{ id: createContactOptionId(), type }])[0];
}

function normalizeProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const avatarType = source.avatarType === "custom" ? "custom" : "virtual";
  const intention = INTENTION_LABELS[source.intention] ? source.intention : DEFAULT_PROFILE.intention;
  const tags = Array.from(new Set((Array.isArray(source.tags) ? source.tags : [])
    .map(tag => normalizeText(tag, 8))
    .filter(Boolean)))
    .slice(0, 3);
  return {
    avatarType,
    avatarValue: normalizeFileValue(source.avatarValue) || DEFAULT_PROFILE.avatarValue,
    avatarColor: /^#[0-9A-Fa-f]{6}$/.test(source.avatarColor || "")
      ? source.avatarColor
      : DEFAULT_PROFILE.avatarColor,
    avatarCloudFileId: normalizeFileValue(source.avatarCloudFileId),
    nickname: normalizeText(source.nickname, 16) || DEFAULT_PROFILE.nickname,
    bio: normalizeText(source.bio, 60) || DEFAULT_PROFILE.bio,
    tags,
    intention,
    contactOptions: normalizeContactOptions(source.contactOptions),
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt : 0
  };
}

function toCloudProfile(value) {
  const profile = normalizeProfile(value);
  return {
    avatarType: profile.avatarType,
    avatarValue: profile.avatarType === "custom" ? profile.avatarCloudFileId : profile.avatarValue,
    avatarColor: profile.avatarColor,
    nickname: profile.nickname,
    bio: profile.bio,
    tags: profile.tags.slice(),
    intention: profile.intention
  };
}

function getProfile() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return normalizeProfile(DEFAULT_PROFILE);
  }
  return normalizeProfile(wx.getStorageSync(STORAGE_KEY));
}

function saveProfile(value) {
  const profile = normalizeProfile(Object.assign({}, value, { updatedAt: Date.now() }));
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    wx.setStorageSync(STORAGE_KEY, profile);
  }
  return profile;
}

function fromCloudProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const cloudAvatar = source.avatarType === "custom"
    ? normalizeFileValue(source.avatarValue)
    : "";
  return normalizeProfile(Object.assign({}, source, {
    avatarCloudFileId: cloudAvatar,
    updatedAt: Date.now()
  }));
}

// 只返回相遇时允许公开的字段，避免本地后续新增的私密字段被意外带出。
function toPublicCard(value) {
  const profile = normalizeProfile(value);
  return {
    avatarType: profile.avatarType,
    avatarValue: profile.avatarValue,
    avatarColor: profile.avatarColor,
    nickname: profile.nickname,
    bio: profile.bio,
    tags: profile.tags.slice(),
    intention: profile.intention,
    intentionLabel: INTENTION_LABELS[profile.intention]
  };
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_PROFILE,
  INTENTION_LABELS,
  normalizeProfile,
  normalizeContactOptions,
  createContactOption,
  getProfile,
  saveProfile,
  fromCloudProfile,
  toCloudProfile,
  toPublicCard
};

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

// Only these fields may be sent when the anonymous encounter lookup is added.
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
  getProfile,
  saveProfile,
  toCloudProfile,
  toPublicCard
};

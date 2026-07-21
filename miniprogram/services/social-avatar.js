const TEMP_URL_CACHE_MS = 30 * 60 * 1000;
const tempUrlCache = Object.create(null);

function normalize(value) {
  return String(value || "").trim().slice(0, 1024);
}

function isCloudFileId(value) {
  return /^cloud:\/\//i.test(normalize(value));
}

function toDisplayProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const profile = Object.assign({}, source);
  const nickname = String(profile.nickname || "").trim();
  const avatarValue = normalize(profile.avatarValue);
  const existingDisplayUrl = normalize(profile.avatarDisplayUrl);
  profile.avatarDisplayUrl = profile.avatarType === "custom"
    ? (existingDisplayUrl || (isCloudFileId(avatarValue) ? "" : avatarValue))
    : "";
  profile.avatarFallback = Array.from(nickname)[0] || "友";
  return profile;
}

function toCacheProfile(value) {
  if (!value || typeof value !== "object") return null;
  const profile = Object.assign({}, value);
  delete profile.avatarDisplayUrl;
  delete profile.avatarFallback;
  return profile;
}

function requestTempUrl(fileId) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.getTempFileURL !== "function") {
      reject(new Error("当前环境无法读取伙伴头像"));
      return;
    }
    wx.cloud.getTempFileURL({
      fileList: [fileId],
      success: result => {
        const list = result && Array.isArray(result.fileList) ? result.fileList : [];
        const file = list.find(item => item && item.fileID === fileId) || list[0];
        const url = normalize(file && file.tempFileURL);
        if (!url || (file.status !== undefined && Number(file.status) !== 0)) {
          reject(new Error(file && file.errMsg || "伙伴头像临时地址获取失败"));
          return;
        }
        resolve(url);
      },
      fail: error => reject(new Error(error && error.errMsg || "伙伴头像读取失败"))
    });
  });
}

async function resolveDisplayProfile(value, options) {
  const profile = toDisplayProfile(value);
  const fileId = normalize(profile.avatarValue);
  if (profile.avatarType !== "custom" || !isCloudFileId(fileId)) return profile;

  const force = options && options.force === true;
  const cached = tempUrlCache[fileId];
  if (!force && cached && cached.expiresAt > Date.now()) {
    profile.avatarDisplayUrl = cached.url;
    return profile;
  }

  const url = await requestTempUrl(fileId);
  tempUrlCache[fileId] = { url, expiresAt: Date.now() + TEMP_URL_CACHE_MS };
  profile.avatarDisplayUrl = url;
  return profile;
}

module.exports = {
  isCloudFileId,
  toDisplayProfile,
  toCacheProfile,
  resolveDisplayProfile
};

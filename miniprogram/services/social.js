const callCloudFunction = require("../utils/cloud");
const profileService = require("./social-profile");

function assertToken(token) {
  if (!Number.isInteger(token) || token <= 0 || token > 0xFFFFFFFF) {
    throw new Error("挂件匿名令牌格式不正确");
  }
  return token >>> 0;
}

function uploadAvatar(filePath) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      reject(new Error("请先选择头像"));
      return;
    }
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function") {
      reject(new Error("当前环境不支持头像云端同步"));
      return;
    }
    const extensionMatch = String(filePath).match(/\.([A-Za-z0-9]{2,5})(?:\?|$)/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "jpg";
    const random = Math.random().toString(36).slice(2, 10);
    wx.cloud.uploadFile({
      cloudPath: `social-avatars/${Date.now()}-${random}.${extension}`,
      filePath,
      success: result => {
        if (!result || !result.fileID) reject(new Error("头像上传没有返回文件标识"));
        else resolve(result.fileID);
      },
      fail: error => reject(new Error((error && error.errMsg) || "头像上传失败"))
    });
  });
}

function deleteCloudFile(fileId) {
  if (!fileId || !wx.cloud || typeof wx.cloud.deleteFile !== "function") return Promise.resolve();
  return new Promise(resolve => {
    wx.cloud.deleteFile({ fileList: [fileId], complete: resolve });
  });
}

async function saveProfile(profileValue) {
  let profile = profileService.normalizeProfile(profileValue);
  let uploadedFileId = "";
  if (profile.avatarType === "custom" && !profile.avatarCloudFileId) {
    uploadedFileId = await uploadAvatar(profile.avatarValue);
    profile = profileService.normalizeProfile(Object.assign({}, profile, {
      avatarCloudFileId: uploadedFileId
    }));
  }

  try {
    const response = await callCloudFunction("social", {
      action: "saveProfile",
      profile: profileService.toCloudProfile(profile)
    });
    return {
      localProfile: profile,
      publicProfile: response.data.profile
    };
  } catch (error) {
    if (uploadedFileId) await deleteCloudFile(uploadedFileId);
    throw error;
  }
}

async function registerToken(token) {
  const response = await callCloudFunction("social", {
    action: "registerToken",
    token: assertToken(token)
  });
  return response.data;
}

async function resolveToken(token) {
  const response = await callCloudFunction("social", {
    action: "resolveToken",
    token: assertToken(token)
  });
  return response.data.profile || null;
}

module.exports = {
  saveProfile,
  registerToken,
  resolveToken,
  uploadAvatar,
  assertToken
};

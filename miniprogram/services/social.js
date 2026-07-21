const callCloudFunction = require("../utils/cloud");
const profileService = require("./social-profile");
const CONTACT_SHARE_PENDING_MAX_AGE_MS = 20 * 60 * 60 * 1000;

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

function uploadContactQr(filePath) {
  return new Promise((resolve, reject) => {
    if (!filePath) {
      reject(new Error("请先选择联系方式二维码"));
      return;
    }
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function") {
      reject(new Error("当前环境不支持二维码云端同步"));
      return;
    }
    const extensionMatch = String(filePath).match(/\.([A-Za-z0-9]{2,5})(?:\?|$)/);
    const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "jpg";
    const random = Math.random().toString(36).slice(2, 10);
    wx.cloud.uploadFile({
      cloudPath: `social-contact-qrs/${Date.now()}-${random}.${extension}`,
      filePath,
      success: result => {
        if (!result || !result.fileID) reject(new Error("二维码上传没有返回文件标识"));
        else resolve(result.fileID);
      },
      fail: error => reject(new Error((error && error.errMsg) || "二维码上传失败"))
    });
  });
}

function deleteCloudFiles(fileIds) {
  const fileList = (Array.isArray(fileIds) ? fileIds : []).filter(Boolean);
  if (!fileList.length || !wx.cloud || typeof wx.cloud.deleteFile !== "function") {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    wx.cloud.deleteFile({ fileList, success: resolve, fail: resolve, complete: resolve });
  });
}

function contactSharePendingKey(conversationId) {
  return `yuntuan_contact_share_pending_${String(conversationId || "")}`;
}

function readPendingContactShare(conversationId) {
  if (typeof wx.getStorageSync !== "function") return null;
  const value = wx.getStorageSync(contactSharePendingKey(conversationId));
  return value && typeof value === "object" ? value : null;
}

function writePendingContactShare(conversationId, value) {
  if (typeof wx.setStorageSync === "function") {
    wx.setStorageSync(contactSharePendingKey(conversationId), value);
  }
}

function clearPendingContactShare(conversationId) {
  if (typeof wx.removeStorageSync === "function") {
    wx.removeStorageSync(contactSharePendingKey(conversationId));
  }
}

function saveContactQrLocally(filePath) {
  return new Promise((resolve, reject) => {
    const source = String(filePath || "");
    if (!source) {
      reject(new Error("请先选择联系方式二维码"));
      return;
    }
    if (/^(?:wxfile|http):\/\/usr\//i.test(source) || typeof wx.saveFile !== "function") {
      resolve(source);
      return;
    }
    wx.saveFile({
      tempFilePath: source,
      success: result => resolve(result && result.savedFilePath || source),
      fail: error => reject(new Error((error && error.errMsg) || "二维码保存到本机失败"))
    });
  });
}

function downloadContactQr(fileId) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud || typeof wx.cloud.downloadFile !== "function") {
      reject(new Error("当前环境无法把旧二维码迁移到本机"));
      return;
    }
    wx.cloud.downloadFile({
      fileID: fileId,
      success: result => {
        if (!result || !result.tempFilePath) reject(new Error("旧二维码下载失败"));
        else resolve(result.tempFilePath);
      },
      fail: error => reject(new Error((error && error.errMsg) || "旧二维码下载失败"))
    });
  });
}

async function localizeContactOptions(profileValue) {
  const profile = profileService.normalizeProfile(profileValue);
  const contactOptions = await Promise.all(profile.contactOptions.map(async option => {
    if (option.type !== "qr") return option;
    let localPath = option.localPath;
    if (!localPath && option.qrCodeFileId) {
      localPath = await downloadContactQr(option.qrCodeFileId);
    }
    localPath = await saveContactQrLocally(localPath);
    return Object.assign({}, option, { localPath, qrCodeFileId: "" });
  }));
  return profileService.normalizeProfile(Object.assign({}, profile, { contactOptions }));
}

async function saveProfile(profileValue) {
  let profile = await localizeContactOptions(profileValue);
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
    // 云函数可能已经保存成功、只是响应在网络中丢失。这里不能删除刚上传的头像，
    // 否则云端名片会指向一个已经被删掉的文件；旧头像由云函数在覆盖时统一清理。
    throw error;
  }
}

async function getMyProfile() {
  const response = await callCloudFunction("social", { action: "getMyProfile" });
  return response.data.profile || null;
}

async function registerToken(token) {
  const response = await callCloudFunction("social", {
    action: "registerToken",
    token: assertToken(token)
  });
  return response.data;
}

async function prepareSoloTestPartner() {
  const response = await callCloudFunction("social", { action: "prepareSoloTestPartner" });
  return response.data;
}

async function resolveToken(token) {
  const response = await callCloudFunction("social", {
    action: "resolveToken",
    token: assertToken(token)
  });
  return {
    profile: response.data.profile || null,
    peerKey: String(response.data.peerKey || ""),
    alreadyKnown: response.data.alreadyKnown === true,
    interactionRef: String(response.data.interactionRef || "")
  };
}

async function sendGreeting(interactionRef) {
  const response = await callCloudFunction("social", {
    action: "sendGreeting",
    interactionRef: String(interactionRef || "")
  });
  return response.data;
}

async function getSocialInbox(options) {
  const source = options && typeof options === "object" ? options : {};
  const request = {
    action: "getSocialInbox",
    section: String(source.section || "all"),
    pageSize: Math.max(1, Math.min(50, Number(source.pageSize) || 20))
  };
  if (source.cursor) request.cursor = String(source.cursor);
  const response = await callCloudFunction("social", request);
  return response.data;
}

async function respondGreeting(greetingId, accept) {
  const response = await callCloudFunction("social", {
    action: "respondGreeting",
    greetingId: String(greetingId || ""),
    accept: accept === true
  });
  return response.data;
}

async function getConversation(conversationId, options) {
  const source = options && typeof options === "object" ? options : {};
  const request = {
    action: "getConversation",
    conversationId: String(conversationId || ""),
    pageSize: source.pageSize || 30
  };
  const beforeCreatedAt = Number(source.beforeCreatedAt) || 0;
  const afterCreatedAt = Number(source.afterCreatedAt) || 0;
  if (beforeCreatedAt > 0) request.beforeCreatedAt = beforeCreatedAt;
  if (afterCreatedAt > 0) request.afterCreatedAt = afterCreatedAt;
  const response = await callCloudFunction("social", request);
  return response.data;
}

async function sendSocialMessage(conversationId, content, requestId) {
  const response = await callCloudFunction("social", {
    action: "sendSocialMessage",
    conversationId: String(conversationId || ""),
    content: String(content || ""),
    requestId: String(requestId || createSocialRequestId())
  });
  return response.data;
}

async function runSoloTestPeerAction(conversationId, testAction) {
  const response = await callCloudFunction("social", {
    action: "soloTestPeerAction",
    conversationId: String(conversationId || ""),
    testAction: String(testAction || "")
  });
  return response.data;
}

async function requestContactExchange(conversationId) {
  const response = await callCloudFunction("social", {
    action: "requestContactExchange",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function respondContactExchange(conversationId, accept) {
  const response = await callCloudFunction("social", {
    action: "respondContactExchange",
    conversationId: String(conversationId || ""),
    accept: accept === true
  });
  return response.data;
}

async function cancelContactExchange(conversationId) {
  const response = await callCloudFunction("social", {
    action: "cancelContactExchange",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function getContactExchange(conversationId) {
  const response = await callCloudFunction("social", {
    action: "getContactExchange",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function shareContact(conversationId, contactOptions) {
  const selected = profileService.normalizeContactOptions(contactOptions);
  const safeConversationId = String(conversationId || "");
  const selectionKey = contactSelectionKey(selected);
  let pending = readPendingContactShare(safeConversationId);
  if (pending && Date.now() - (Number(pending.preparedAt) || 0) >= CONTACT_SHARE_PENDING_MAX_AGE_MS) {
    await cancelStagedContactShare(safeConversationId, pending.requestId).catch(() => {});
    clearPendingContactShare(safeConversationId);
    pending = null;
  }
  if (pending && pending.selectionKey !== selectionKey) {
    await cancelStagedContactShare(safeConversationId, pending.requestId).catch(() => {});
    clearPendingContactShare(safeConversationId);
    pending = null;
  }
  if (!pending) {
    pending = await prepareContactShare(safeConversationId, selected, selectionKey);
    writePendingContactShare(safeConversationId, pending);
  }
  const response = await callCloudFunction("social", {
    action: "shareContact",
    conversationId: safeConversationId,
    contactItems: pending.contactItems,
    requestId: pending.requestId
  });
  clearPendingContactShare(safeConversationId);
  return response.data;
}

async function prepareContactShare(conversationId, selected, selectionKey) {
  const requestId = createSocialRequestId("contact");
  const contactItems = [];
  const uploadedFileIds = [];
  try {
    for (const option of selected) {
      if (option.type !== "qr") {
        contactItems.push({ id: option.id, type: option.type, label: option.label, value: option.value });
        continue;
      }
      const qrCodeFileId = option.localPath
        ? await uploadContactQr(option.localPath)
        : option.qrCodeFileId;
      if (!qrCodeFileId) throw new Error(`请为${option.label}选择二维码`);
      if (option.localPath) uploadedFileIds.push(qrCodeFileId);
      await callCloudFunction("social", {
        action: "stageContactQr",
        conversationId,
        optionId: option.id,
        fileId: qrCodeFileId,
        requestId
      });
      contactItems.push({ id: option.id, type: option.type, label: option.label, qrCodeFileId });
    }
    return { requestId, selectionKey, contactItems, preparedAt: Date.now() };
  } catch (error) {
    await cancelStagedContactShare(conversationId, requestId).catch(() => {});
    await deleteCloudFiles(uploadedFileIds);
    throw error;
  }
}

async function cancelStagedContactShare(conversationId, requestId) {
  if (!requestId) return;
  await callCloudFunction("social", {
    action: "cancelStagedContactShare",
    conversationId: String(conversationId || ""),
    requestId: String(requestId)
  });
}

function contactSelectionKey(options) {
  return JSON.stringify((Array.isArray(options) ? options : []).map(option => ({
    id: option.id,
    type: option.type,
    label: option.label,
    value: option.value || "",
    source: option.localPath || option.qrCodeFileId || ""
  })));
}

async function withdrawContact(conversationId) {
  const response = await callCloudFunction("social", {
    action: "withdrawContact",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function clearConversationForMe(conversationId) {
  const response = await callCloudFunction("social", {
    action: "clearConversationForMe",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function endRelationship(conversationId) {
  const response = await callCloudFunction("social", {
    action: "endRelationship",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function blockUser(conversationId) {
  const response = await callCloudFunction("social", {
    action: "blockUser",
    conversationId: String(conversationId || "")
  });
  return response.data;
}

async function getBlockedUsers() {
  const response = await callCloudFunction("social", { action: "getBlockedUsers" });
  return response.data.blockedUsers || [];
}

async function unblockUser(blockId) {
  const response = await callCloudFunction("social", {
    action: "unblockUser",
    blockId: String(blockId || "")
  });
  return response.data;
}

async function reportMessage(conversationId, messageId, reason, note) {
  const response = await callCloudFunction("social", {
    action: "reportMessage",
    conversationId: String(conversationId || ""),
    messageId: String(messageId || ""),
    reason: String(reason || "other"),
    note: String(note || "")
  });
  return response.data;
}

function createSocialRequestId(prefix) {
  const random = Math.random().toString(36).slice(2, 12);
  return `${String(prefix || "msg")}_${Date.now().toString(36)}_${random}`;
}

async function deleteMyData() {
  const response = await callCloudFunction("social", { action: "deleteMyData" });
  return response.data;
}

module.exports = {
  saveProfile,
  getMyProfile,
  registerToken,
  prepareSoloTestPartner,
  resolveToken,
  sendGreeting,
  getSocialInbox,
  respondGreeting,
  getConversation,
  sendSocialMessage,
  runSoloTestPeerAction,
  requestContactExchange,
  respondContactExchange,
  cancelContactExchange,
  getContactExchange,
  shareContact,
  withdrawContact,
  clearConversationForMe,
  endRelationship,
  blockUser,
  getBlockedUsers,
  unblockUser,
  reportMessage,
  createSocialRequestId,
  deleteMyData,
  uploadAvatar,
  uploadContactQr,
  saveContactQrLocally,
  localizeContactOptions,
  assertToken
};

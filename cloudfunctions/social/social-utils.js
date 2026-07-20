const crypto = require("crypto");
const INTENTIONS = new Set(["chat", "buddy", "quiet"]);

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  return error;
}

function success(data) { return { code: 0, message: "success", data }; }

function normalizeProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const avatarType = source.avatarType === "custom" ? "custom" : "virtual";
  const avatarValue = cleanText(source.avatarValue, avatarType === "custom" ? 512 : 8, "头像不能为空");
  if (avatarType === "custom" && !isManagedAvatar(avatarValue)) throw publicError(400, "自定义头像必须先上传到云存储");
  const avatarColor = /^#[0-9A-Fa-f]{6}$/.test(source.avatarColor || "") ? source.avatarColor : "#DFECE5";
  const nickname = cleanText(source.nickname, 16, "请填写昵称");
  const bio = cleanText(source.bio, 60, "请填写一句话介绍");
  const tags = Array.from(new Set((Array.isArray(source.tags) ? source.tags : [])
    .map(tag => cleanText(tag, 8, "")).filter(Boolean))).slice(0, 3);
  const intention = INTENTIONS.has(source.intention) ? source.intention : "chat";
  return { avatarType, avatarValue, avatarColor, nickname, bio, tags, intention };
}

function toPublicProfile(record) {
  const profile = {
    avatarType: record.avatarType, avatarValue: record.avatarValue, avatarColor: record.avatarColor,
    nickname: record.nickname, bio: record.bio,
    tags: Array.isArray(record.tags) ? record.tags.slice(0, 3) : [],
    intention: record.intention,
    intentionLabel: record.intention === "buddy" ? "找搭子" : (record.intention === "quiet" ? "暂不打扰" : "可以聊天")
  };
  if (record.soloTestForOwnerKey) profile.isSoloTest = true;
  return profile;
}

function toPrivateProfile(record) {
  const profile = toPublicProfile(record);
  if (Array.isArray(record && record.contactOptions) && record.contactOptions.length) {
    profile.legacyContactOptions = normalizeContactOptions(record.contactOptions);
  }
  return profile;
}

function isNotFoundError(error) {
  const message = String(error && (error.errMsg || error.message) || "");
  return message.includes("does not exist") || message.includes("NOT_FOUND") ||
    message.includes("DOCUMENT_NOT_EXIST") || message.includes("-502005");
}

function normalizeToken(value) {
  const token = Number(value);
  if (!Number.isInteger(token) || token <= 0 || token > 0xFFFFFFFF) throw publicError(400, "匿名设备令牌格式不正确");
  return token >>> 0;
}

function cleanText(value, maxLength, emptyMessage) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text && emptyMessage) throw publicError(400, emptyMessage);
  if (Array.from(text).length > maxLength) throw publicError(400, `内容不能超过 ${maxLength} 个字符`);
  return text;
}

function isManagedAvatar(value) { return typeof value === "string" && value.startsWith("cloud://") && value.includes("/social-avatars/"); }
function isManagedContactQr(value) { return typeof value === "string" && value.startsWith("cloud://") && value.includes("/social-contact-qrs/"); }
function sha256(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function tokenDocumentId(appid, token) { return sha256(`${appid}:social-token:${token >>> 0}`); }
function greetingDocumentId(sender, recipient) { return sha256(`greeting:${sender}:${recipient}`); }
function matchDocumentId(owner, peer) { return sha256(`match:${owner}:${peer}`); }
function conversationDocumentId(first, second) { const members = [first, second].sort(); return sha256(`conversation:${members[0]}:${members[1]}`); }
function soloTestPeerOwnerKey(owner) { return sha256(`solo-test-peer:${owner}`); }
function contactDocumentId(conversationId, owner) { return sha256(`contact:${conversationId}:${owner}`); }
function contactFileDocumentId(fileId) { return sha256(`contact-file:${fileId}`); }
function blockDocumentId(blocker, blocked) { return sha256(`block:${blocker}:${blocked}`); }

function getConversationPeer(conversation, ownerKey) {
  if (!conversation) return "";
  if (conversation.memberAOwnerKey === ownerKey) return conversation.memberBOwnerKey || "";
  if (conversation.memberBOwnerKey === ownerKey) return conversation.memberAOwnerKey || "";
  return "";
}

function cleanMessageText(value) {
  const text = String(value || "").trim();
  if (!text) throw publicError(400, "消息不能为空");
  if (Array.from(text).length > 300) throw publicError(400, "消息不能超过 300 个字符");
  if (containsRestrictedLink(text)) throw publicError(400, "为保护双方安全，伙伴聊天暂不支持发送网址或外部链接");
  if (containsDirectContactDetails(text)) throw publicError(400, "请使用双方确认后的“交换联系方式”功能分享联系方式");
  return text;
}

function containsRestrictedLink(text) {
  return /(?:https?:\/\/|www\.|weixin:\/\/|wxp:\/\/|[a-z0-9-]+\.(?:com|cn|net|org|top|xyz|io)(?:[\s/]|$))/i.test(text);
}
function containsDirectContactDetails(text) {
  if (/(?:^|\D)1[3-9]\d{9}(?:\D|$)/.test(text)) return true;
  return /(?:微信号?|vx|v信|手机号|电话号码?)\s*[:：]?\s*[A-Za-z0-9_-]{5,}/i.test(text);
}

function normalizeContactOptions(value) {
  const source = Array.isArray(value) ? value : [];
  if (source.length > 8) throw publicError(400, "私密分享资料最多保存 8 条");
  const usedIds = new Set();
  return source.map(item => {
    const option = item && typeof item === "object" ? item : {};
    const id = String(option.id || "").trim();
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || usedIds.has(id)) throw publicError(400, "私密分享资料编号无效，请删除后重新添加");
    usedIds.add(id);
    const type = ["wechat", "phone", "qr"].includes(option.type) ? option.type : "";
    if (!type) throw publicError(400, "私密分享资料类型无效");
    const defaultLabel = type === "wechat" ? "微信号" : (type === "phone" ? "手机号" : "联系二维码");
    const label = cleanText(option.label, 12, "") || defaultLabel;
    if (type === "qr") {
      const qrCodeFileId = String(option.qrCodeFileId || "").trim();
      if (!isManagedContactQr(qrCodeFileId)) throw publicError(400, `${label}的二维码尚未上传完成`);
      return { id, type, label, qrCodeFileId };
    }
    const contactValue = String(option.value || "").trim().replace(/\s+/g, type === "phone" ? "" : " ");
    if (type === "wechat") {
      if (!/^[^\s]{5,32}$/.test(contactValue) || containsRestrictedLink(contactValue)) throw publicError(400, `${label}格式不正确`);
    } else {
      const phoneDigits = contactValue.replace(/\D/g, "");
      if (!/^\+?[0-9-]{6,20}$/.test(contactValue) || phoneDigits.length < 6 || phoneDigits.length > 15) throw publicError(400, `${label}格式不正确`);
    }
    return { id, type, label, value: contactValue };
  });
}

function toStoredContactItem(option) {
  return option.type === "qr" ? { id: option.id, type: option.type, label: option.label, qrCodeFileId: option.qrCodeFileId }
    : { id: option.id, type: option.type, label: option.label, value: option.value };
}

function toPublicContact(record) {
  let items;
  if (record && Array.isArray(record.items)) items = normalizeContactOptions(record.items);
  else {
    const legacy = [];
    if (record && record.wechatId) legacy.push({ id: "legacy_wechat", type: "wechat", label: "微信号", value: record.wechatId });
    if (record && record.phone) legacy.push({ id: "legacy_phone", type: "phone", label: "手机号", value: record.phone });
    if (record && isManagedContactQr(record.qrCodeFileId)) legacy.push({ id: "legacy_qrcode", type: "qr", label: "联系二维码", qrCodeFileId: record.qrCodeFileId });
    items = normalizeContactOptions(legacy);
  }
  return { items, updatedAt: Number(record && record.updatedAt) || 0 };
}

function profileContactQrIds(record) {
  return (record && Array.isArray(record.contactOptions) ? record.contactOptions : [])
    .filter(option => option && option.type === "qr" && isManagedContactQr(option.qrCodeFileId)).map(option => option.qrCodeFileId);
}
function contactRecordQrIds(record) {
  if (!record) return [];
  if (Array.isArray(record.items)) return record.items.filter(item => item && item.type === "qr" && isManagedContactQr(item.qrCodeFileId)).map(item => item.qrCodeFileId);
  return isManagedContactQr(record.qrCodeFileId) ? [record.qrCodeFileId] : [];
}
function normalizeContactNotice(value) { return new Set(["requested", "accepted", "declined", "contact_updated", "contact_withdrawn"]).has(value) ? value : ""; }
function beijingDayKey(timestamp) { const date = new Date((Number(timestamp) || Date.now()) + 28800000); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`; }
function normalizeRequestId(value) { const id = String(value || "").trim(); if (!/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw publicError(400, "消息请求编号无效"); return id; }
function toPublicMessage(record, ownerKey) { return { id: String(record._id || ""), sender: record.senderOwnerKey === ownerKey ? "me" : "peer", content: String(record.content || ""), createdAt: Number(record.createdAt) || 0 }; }
function normalizeOpaqueId(value, length, message) { const id = String(value || "").trim().toLowerCase(); if (!(new RegExp(`^[a-f0-9]{${length}}$`)).test(id)) throw publicError(400, message); return id; }
function withoutDocumentId(value) { const copy = Object.assign({}, value || {}); delete copy._id; return copy; }

module.exports = {
  publicError, success, normalizeProfile, toPublicProfile, toPrivateProfile, isNotFoundError,
  normalizeToken, cleanText, isManagedAvatar, isManagedContactQr, sha256, tokenDocumentId,
  greetingDocumentId, matchDocumentId, conversationDocumentId, soloTestPeerOwnerKey,
  contactDocumentId, contactFileDocumentId, blockDocumentId, getConversationPeer,
  cleanMessageText, containsRestrictedLink, containsDirectContactDetails, normalizeContactOptions,
  toStoredContactItem, toPublicContact, profileContactQrIds, contactRecordQrIds,
  normalizeContactNotice, beijingDayKey, normalizeRequestId, toPublicMessage,
  normalizeOpaqueId, withoutDocumentId
};

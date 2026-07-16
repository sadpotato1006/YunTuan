const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const PROFILE_COLLECTION = "social_profiles";
const TOKEN_COLLECTION = "social_tokens";
const RESOLVE_USAGE_COLLECTION = "social_resolve_usage";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESOLVE_LIMIT_PER_MINUTE = 30;
const INTENTIONS = new Set(["chat", "buddy", "quiet"]);

exports.main = async event => {
  try {
    const safeEvent = event && typeof event === "object" ? event : {};
    const action = safeEvent.action;
    const context = cloud.getWXContext();
    const openid = context && typeof context.OPENID === "string" ? context.OPENID.trim() : "";
    if (!openid) throw publicError(401, "无法确认当前微信用户，请重新进入小程序");
    const ownerKey = sha256(openid);

    if (action === "saveProfile") {
      return success({ profile: await saveProfile(ownerKey, safeEvent.profile) });
    }
    if (action === "getMyProfile") {
      const record = await readDocument(PROFILE_COLLECTION, ownerKey);
      return success({ profile: record ? toPublicProfile(record) : null });
    }
    if (action === "registerToken") {
      const profile = await readDocument(PROFILE_COLLECTION, ownerKey);
      if (!profile) throw publicError(409, "请先保存社交名片");
      const token = normalizeToken(safeEvent.token);
      const now = Date.now();
      const tokenId = tokenDocumentId(context.APPID || "yuntuan", token);
      await db.collection(TOKEN_COLLECTION).doc(tokenId).set({
        data: { ownerKey, expiresAt: now + TOKEN_TTL_MS, updatedAt: now }
      });
      return success({ registered: true, expiresAt: now + TOKEN_TTL_MS });
    }
    if (action === "resolveToken") {
      if (!await readDocument(PROFILE_COLLECTION, ownerKey)) {
        throw publicError(409, "请先保存自己的社交名片");
      }
      await assertResolveQuota(ownerKey);
      const token = normalizeToken(safeEvent.token);
      const tokenId = tokenDocumentId(context.APPID || "yuntuan", token);
      const mapping = await readDocument(TOKEN_COLLECTION, tokenId);
      if (!mapping || !mapping.ownerKey || mapping.expiresAt <= Date.now()) {
        return success({ profile: null, reason: "not_found" });
      }
      if (mapping.ownerKey === ownerKey) {
        return success({ profile: null, reason: "self" });
      }
      const profile = await readDocument(PROFILE_COLLECTION, mapping.ownerKey);
      return success({ profile: profile ? toPublicProfile(profile) : null });
    }
    return { code: 400, message: "不支持的社交名片操作", data: {} };
  } catch (error) {
    if (error && error.publicMessage) {
      return { code: error.code || 400, message: error.publicMessage, data: {} };
    }
    console.error("社交名片云函数处理失败：", {
      code: error && (error.errCode || error.code),
      message: error && (error.errMsg || error.message)
    });
    return { code: 500, message: "社交名片服务暂时不可用，请稍后再试", data: {} };
  }
};

async function saveProfile(ownerKey, value) {
  const profile = normalizeProfile(value);
  const previous = await readDocument(PROFILE_COLLECTION, ownerKey);
  const now = Date.now();
  const record = Object.assign({ ownerKey, updatedAt: now }, profile);
  await db.collection(PROFILE_COLLECTION).doc(ownerKey).set({ data: record });

  const oldAvatar = previous && previous.avatarType === "custom" ? previous.avatarValue : "";
  if (oldAvatar && oldAvatar !== profile.avatarValue && isManagedAvatar(oldAvatar)) {
    try {
      await cloud.deleteFile({ fileList: [oldAvatar] });
    } catch (error) {
      console.warn("旧社交头像删除失败：", error && (error.errMsg || error.message));
    }
  }
  return toPublicProfile(record);
}

function normalizeProfile(value) {
  const source = value && typeof value === "object" ? value : {};
  const avatarType = source.avatarType === "custom" ? "custom" : "virtual";
  const avatarValue = cleanText(source.avatarValue, avatarType === "custom" ? 512 : 8, "头像不能为空");
  if (avatarType === "custom" && !isManagedAvatar(avatarValue)) {
    throw publicError(400, "自定义头像必须先上传到云存储");
  }
  const avatarColor = /^#[0-9A-Fa-f]{6}$/.test(source.avatarColor || "")
    ? source.avatarColor
    : "#DFECE5";
  const nickname = cleanText(source.nickname, 16, "请填写昵称");
  const bio = cleanText(source.bio, 60, "请填写一句话介绍");
  const tags = Array.from(new Set((Array.isArray(source.tags) ? source.tags : [])
    .map(tag => cleanText(tag, 8, ""))
    .filter(Boolean)))
    .slice(0, 3);
  const intention = INTENTIONS.has(source.intention) ? source.intention : "chat";
  return { avatarType, avatarValue, avatarColor, nickname, bio, tags, intention };
}

function toPublicProfile(record) {
  return {
    avatarType: record.avatarType,
    avatarValue: record.avatarValue,
    avatarColor: record.avatarColor,
    nickname: record.nickname,
    bio: record.bio,
    tags: Array.isArray(record.tags) ? record.tags.slice(0, 3) : [],
    intention: record.intention,
    intentionLabel: record.intention === "buddy"
      ? "找搭子"
      : (record.intention === "quiet" ? "暂不打扰" : "可以聊天")
  };
}

async function assertResolveQuota(ownerKey) {
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  const previous = await readDocument(RESOLVE_USAGE_COLLECTION, ownerKey);
  const count = previous && previous.minuteBucket === minuteBucket ? previous.count || 0 : 0;
  if (count >= RESOLVE_LIMIT_PER_MINUTE) {
    throw publicError(429, "附近名片查询过于频繁，请稍后再试");
  }
  await db.collection(RESOLVE_USAGE_COLLECTION).doc(ownerKey).set({
    data: { minuteBucket, count: count + 1, updatedAt: now }
  });
}

async function readDocument(collectionName, id) {
  try {
    const result = await db.collection(collectionName).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || "");
    if (message.includes("does not exist") || message.includes("NOT_FOUND") || message.includes("-502005")) {
      return null;
    }
    throw error;
  }
}

function normalizeToken(value) {
  const token = Number(value);
  if (!Number.isInteger(token) || token <= 0 || token > 0xFFFFFFFF) {
    throw publicError(400, "匿名设备令牌格式不正确");
  }
  return token >>> 0;
}

function cleanText(value, maxLength, emptyMessage) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text && emptyMessage) throw publicError(400, emptyMessage);
  if (Array.from(text).length > maxLength) throw publicError(400, `内容不能超过 ${maxLength} 个字符`);
  return text;
}

function isManagedAvatar(value) {
  return typeof value === "string" && value.startsWith("cloud://") && value.includes("/social-avatars/");
}

function tokenDocumentId(appid, token) {
  return sha256(`${appid}:social-token:${token >>> 0}`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function success(data) {
  return { code: 0, message: "success", data };
}

function publicError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.publicMessage = message;
  return error;
}

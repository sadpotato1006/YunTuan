const profileService = require("./social-profile");

const STORAGE_KEY = "yuntuan_social_encounters_v2";
const STORAGE_VERSION = 2;
const MAX_RECORDS = 30;
const PEER_TOKEN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function readStore() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return { version: STORAGE_VERSION, records: [] };
  }
  const value = wx.getStorageSync(STORAGE_KEY);
  if (!value || typeof value !== "object" || !Array.isArray(value.records)) {
    return { version: STORAGE_VERSION, records: [] };
  }
  return {
    version: STORAGE_VERSION,
    records: value.records.map(normalizeStoredRecord).filter(Boolean).slice(0, MAX_RECORDS)
  };
}

function writeStore(store) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return;
  wx.setStorageSync(STORAGE_KEY, {
    version: STORAGE_VERSION,
    records: store.records.slice(0, MAX_RECORDS)
  });
}

function saveEncounter(event) {
  const source = event && typeof event === "object" ? event : {};
  const encounterId = normalizeEncounterId(source.encounterId);
  const store = readStore();
  const existing = store.records.find(record => record.encounterId === encounterId);
  if (existing) return { record: clone(existing), duplicate: true };

  const receivedAt = Date.now();
  const timestampValid = Boolean(source.timestampValid) &&
    Number.isInteger(source.occurredAt) && source.occurredAt > 0;
  const record = {
    encounterId,
    peerToken: normalizeToken(source.peerToken),
    rssi: normalizeRssi(source.rssi),
    occurredAt: timestampValid ? source.occurredAt * 1000 : receivedAt,
    timeEstimated: !timestampValid,
    receivedAt,
    status: "pending",
    profile: null,
    interactionRef: "",
    greetingStatus: "none",
    errorMessage: "",
    updatedAt: receivedAt
  };
  store.records.unshift(record);
  store.records = store.records.slice(0, MAX_RECORDS);
  writeStore(store);
  return { record: clone(record), duplicate: false };
}

function markResolved(encounterId, resolutionValue) {
  return updateRecord(encounterId, record => {
    const resolution = resolutionValue && resolutionValue.profile !== undefined
      ? resolutionValue
      : { profile: resolutionValue, interactionRef: "" };
    const profile = resolution.profile;
    if (profile) {
      record.profile = profileService.toPublicCard(profile);
      record.peerToken = 0;
      record.interactionRef = normalizeInteractionRef(resolution.interactionRef);
      record.status = "resolved";
      record.errorMessage = "";
    } else {
      record.status = "unavailable";
      record.errorMessage = "对方暂未公开社交名片";
    }
  });
}

function markGreeting(encounterId, statusValue) {
  return updateRecord(encounterId, record => {
    const status = String(statusValue || "");
    if (!["none", "sent", "matched", "declined"].includes(status)) {
      throw new Error("招呼状态不正确");
    }
    record.greetingStatus = status;
  });
}

function markFailed(encounterId, message) {
  return updateRecord(encounterId, record => {
    record.status = "failed";
    record.errorMessage = String(message || "对方名片暂时无法获取").slice(0, 100);
  });
}

function updateRecord(encounterId, updater) {
  const normalizedId = normalizeEncounterId(encounterId);
  const store = readStore();
  const record = store.records.find(item => item.encounterId === normalizedId);
  if (!record) return null;
  updater(record);
  record.updatedAt = Date.now();
  writeStore(store);
  return clone(record);
}

function getRecord(encounterId) {
  const normalizedId = normalizeEncounterId(encounterId);
  const record = readStore().records.find(item => item.encounterId === normalizedId);
  return record ? clone(record) : null;
}

function getLatestRecord() {
  const record = readStore().records[0];
  return record ? clone(record) : null;
}

function getDisplayRecords() {
  return readStore().records.map(toDisplayRecord);
}

function clearRecords() {
  writeStore({ version: STORAGE_VERSION, records: [] });
}

function toDisplayRecord(value) {
  const record = normalizeStoredRecord(value);
  if (!record) return null;
  return {
    encounterId: record.encounterId,
    rssi: record.rssi,
    occurredAt: record.occurredAt,
    timeEstimated: record.timeEstimated,
    receivedAt: record.receivedAt,
    status: record.status,
    profile: record.profile ? clone(record.profile) : null,
    interactionRef: record.interactionRef,
    greetingStatus: record.greetingStatus,
    errorMessage: record.errorMessage,
    updatedAt: record.updatedAt
  };
}

function normalizeStoredRecord(value) {
  if (!value || typeof value !== "object") return null;
  let encounterId;
  try {
    encounterId = normalizeEncounterId(value.encounterId);
  } catch (error) {
    return null;
  }
  const profile = value.profile && typeof value.profile === "object"
    ? profileService.toPublicCard(value.profile)
    : null;
  let status = ["pending", "resolved", "unavailable", "failed"].includes(value.status)
    ? value.status
    : (profile ? "resolved" : "pending");
  const receivedAt = normalizeTimestamp(value.receivedAt);
  const tokenExpired = !profile && receivedAt > 0 &&
    Date.now() - receivedAt > PEER_TOKEN_RETENTION_MS;
  const interactionExpired = receivedAt > 0 &&
    Date.now() - receivedAt > PEER_TOKEN_RETENTION_MS;
  if (tokenExpired) status = "unavailable";
  return {
    encounterId,
    peerToken: profile || tokenExpired ? 0 : normalizeToken(value.peerToken),
    rssi: normalizeRssi(value.rssi),
    occurredAt: normalizeTimestamp(value.occurredAt),
    timeEstimated: Boolean(value.timeEstimated),
    receivedAt,
    status,
    profile,
    interactionRef: interactionExpired ? "" : normalizeInteractionRef(value.interactionRef),
    greetingStatus: ["sent", "matched", "declined"].includes(value.greetingStatus)
      ? value.greetingStatus
      : "none",
    errorMessage: String(tokenExpired ? "相遇名片查询期限已过" : (value.errorMessage || "")).slice(0, 100),
    updatedAt: normalizeTimestamp(value.updatedAt)
  };
}

function normalizeEncounterId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(id)) throw new Error("相遇事件编号格式不正确");
  return id;
}

function normalizeToken(value) {
  const token = Number(value);
  return Number.isInteger(token) && token > 0 && token <= 0xFFFFFFFF ? token >>> 0 : 0;
}

function normalizeRssi(value) {
  const rssi = Number(value);
  if (!Number.isFinite(rssi)) return -127;
  return Math.max(-127, Math.min(20, Math.round(rssi)));
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp) : 0;
}

function normalizeInteractionRef(value) {
  const reference = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{48}$/.test(reference) ? reference : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  STORAGE_KEY,
  MAX_RECORDS,
  PEER_TOKEN_RETENTION_MS,
  saveEncounter,
  markResolved,
  markFailed,
  markGreeting,
  getRecord,
  getLatestRecord,
  getDisplayRecords,
  clearRecords,
  toDisplayRecord,
  normalizeEncounterId
};

const STORAGE_KEY = "yuntuan_social_inbox_cache_v1";
const STORAGE_VERSION = 1;
const CACHE_FRESH_MS = 2 * 60 * 1000;
const MAX_ITEMS_PER_SECTION = 50;

function emptyCache() {
  return {
    version: STORAGE_VERSION,
    greetings: [],
    matches: [],
    blockedUsers: [],
    pagination: emptyPagination(),
    syncedAt: 0,
    savedAt: 0
  };
}

function emptyPagination() {
  return {
    friends: { hasMore: false, nextCursor: "" },
    greetings: { hasMore: false, nextCursor: "" }
  };
}

function readInbox() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return null;
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    if (!value || value.version !== STORAGE_VERSION) return null;
    return normalizeCache(value);
  } catch (error) {
    return null;
  }
}

function writeInbox(value) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return false;
  const normalized = normalizeCache(Object.assign({}, value, {
    version: STORAGE_VERSION,
    savedAt: Date.now()
  }));
  try {
    wx.setStorageSync(STORAGE_KEY, normalized);
    return true;
  } catch (error) {
    return false;
  }
}

function mergeFirstPage(inboxValue, syncedAt) {
  const inbox = inboxValue && typeof inboxValue === "object" ? inboxValue : {};
  const previous = readInbox() || emptyCache();
  const pagination = inbox.pagination && typeof inbox.pagination === "object"
    ? inbox.pagination
    : previous.pagination;
  const normalizedPagination = normalizePagination(pagination);
  return writeInbox({
    greetings: normalizedPagination.greetings.hasMore
      ? mergeUnique(inbox.greetings, previous.greetings, "greetingId")
      : (Array.isArray(inbox.greetings) ? inbox.greetings : previous.greetings),
    matches: normalizedPagination.friends.hasMore
      ? mergeUnique(inbox.matches, previous.matches, "conversationId")
      : (Array.isArray(inbox.matches) ? inbox.matches : previous.matches),
    blockedUsers: previous.blockedUsers,
    pagination: normalizedPagination,
    syncedAt: Math.max(0, Number(syncedAt) || Date.now())
  });
}

function normalizeCache(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    version: STORAGE_VERSION,
    greetings: sanitizeItems(source.greetings),
    matches: sanitizeItems(source.matches),
    blockedUsers: sanitizeItems(source.blockedUsers),
    pagination: normalizePagination(source.pagination),
    syncedAt: Math.max(0, Number(source.syncedAt) || 0),
    savedAt: Math.max(0, Number(source.savedAt) || 0)
  };
}

function sanitizeItems(value) {
  return (Array.isArray(value) ? value : []).filter(Boolean)
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map(item => {
      const copy = Object.assign({}, item);
      delete copy.timeText;
      delete copy.summary;
      delete copy.unreadText;
      delete copy.hasNotice;
      delete copy.avatarFailed;
      if (copy.profile && typeof copy.profile === "object") {
        copy.profile = Object.assign({}, copy.profile);
        delete copy.profile.avatarDisplayUrl;
        delete copy.profile.avatarFallback;
      }
      return copy;
    });
}

function normalizePagination(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    friends: normalizePage(source.friends),
    greetings: normalizePage(source.greetings)
  };
}

function normalizePage(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    hasMore: source.hasMore === true,
    nextCursor: String(source.nextCursor || "")
  };
}

function mergeUnique(primary, secondary, key) {
  const result = [];
  const used = new Set();
  [primary, secondary].forEach(items => (Array.isArray(items) ? items : []).forEach(item => {
    const id = String(item && item[key] || "");
    if (!id || used.has(id)) return;
    used.add(id);
    result.push(item);
  }));
  return result.slice(0, MAX_ITEMS_PER_SECTION);
}

function isFresh(value, now) {
  const syncedAt = value && typeof value === "object" ? Number(value.syncedAt) : Number(value);
  const current = Number(now) || Date.now();
  return syncedAt > 0 && current >= syncedAt && current - syncedAt < CACHE_FRESH_MS;
}

function badgeCount(value) {
  const source = value && typeof value === "object" ? value : {};
  const greetings = Array.isArray(source.greetings) ? source.greetings : [];
  const matches = Array.isArray(source.matches) ? source.matches : [];
  return greetings.length + matches.reduce((total, item) => {
    const unread = Math.max(0, Number(item && item.unreadCount) || 0);
    return total + unread + (item && item.newMatch && unread === 0 ? 1 : 0) +
      (item && item.contactNotice && !item.newMatch ? 1 : 0);
  }, 0);
}

module.exports = {
  STORAGE_KEY,
  CACHE_FRESH_MS,
  MAX_ITEMS_PER_SECTION,
  readInbox,
  writeInbox,
  mergeFirstPage,
  isFresh,
  badgeCount
};

const STORAGE_KEY = "yuntuan_social_chat_cache_v1";
const STORAGE_VERSION = 1;
const MAX_CONVERSATIONS = 12;
const MAX_MESSAGES_PER_CONVERSATION = 100;
const CACHE_FRESH_MS = 30000;

function validConversationId(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ""));
}

function emptyStore() {
  return { version: STORAGE_VERSION, entries: {} };
}

function readStore() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return emptyStore();
  try {
    const value = wx.getStorageSync(STORAGE_KEY);
    if (!value || value.version !== STORAGE_VERSION || !value.entries || typeof value.entries !== "object") {
      return emptyStore();
    }
    return value;
  } catch (error) {
    return emptyStore();
  }
}

function writeStore(store) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") return false;
  try {
    wx.setStorageSync(STORAGE_KEY, store);
    return true;
  } catch (error) {
    return false;
  }
}

function trimMessages(items) {
  const messages = Array.isArray(items) ? items.filter(Boolean) : [];
  return messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
}

function cacheProfile(value) {
  if (!value || typeof value !== "object") return null;
  const profile = Object.assign({}, value);
  delete profile.avatarDisplayUrl;
  delete profile.avatarFallback;
  return profile;
}

function readConversation(conversationId) {
  const id = String(conversationId || "");
  if (!validConversationId(id)) return null;
  const value = readStore().entries[id];
  if (!value || typeof value !== "object" || !Array.isArray(value.messages)) return null;
  return value;
}

function writeConversation(conversationId, state) {
  const id = String(conversationId || "");
  if (!validConversationId(id)) return false;
  const source = state && typeof state === "object" ? state : {};
  const allMessages = Array.isArray(source.messages) ? source.messages : [];
  const messages = trimMessages(allMessages);
  const wasTrimmed = messages.length < allMessages.length;
  const store = readStore();
  const now = Date.now();
  store.entries[id] = {
    profile: cacheProfile(source.profile),
    messages,
    hasMoreMessages: wasTrimmed || source.hasMoreMessages === true,
    messageCursor: wasTrimmed && messages[0]
      ? (Number(messages[0].createdAt) || Number(source.messageCursor) || 0)
      : (Number(source.messageCursor) || 0),
    messagePolicy: source.messagePolicy && typeof source.messagePolicy === "object"
      ? source.messagePolicy
      : null,
    contactExchange: source.contactExchange && typeof source.contactExchange === "object"
      ? source.contactExchange
      : null,
    syncedAt: Math.max(0, Number(source.syncedAt) || 0),
    savedAt: now
  };

  const ids = Object.keys(store.entries).sort((first, second) => {
    return (Number(store.entries[second] && store.entries[second].savedAt) || 0) -
      (Number(store.entries[first] && store.entries[first].savedAt) || 0);
  });
  ids.slice(MAX_CONVERSATIONS).forEach(key => { delete store.entries[key]; });
  return writeStore(store);
}

function removeConversation(conversationId) {
  const id = String(conversationId || "");
  if (!validConversationId(id)) return false;
  const store = readStore();
  if (!store.entries[id]) return true;
  delete store.entries[id];
  return writeStore(store);
}

function patchConversation(conversationId, patch) {
  const previous = readConversation(conversationId);
  if (!previous) return false;
  return writeConversation(conversationId, Object.assign({}, previous, patch || {}, {
    syncedAt: previous.syncedAt
  }));
}

function isFresh(value, now) {
  const syncedAt = typeof value === "object" && value
    ? Number(value.syncedAt)
    : Number(value);
  const current = Number(now) || Date.now();
  return syncedAt > 0 && current >= syncedAt && current - syncedAt < CACHE_FRESH_MS;
}

module.exports = {
  CACHE_FRESH_MS,
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CONVERSATION,
  readConversation,
  writeConversation,
  patchConversation,
  removeConversation,
  isFresh
};

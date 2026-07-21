const socialService = require("../../services/social");
const socialAvatar = require("../../services/social-avatar");
const deviceService = require("../../services/device");
const tabSwipe = require("../../utils/tab-swipe");
const ACTIVE_REFRESH_MS = 15000;
const MAX_REFRESH_MS = 60000;

Page({
  data: {
    loading: true,
    encounterCount: 0,
    greetings: [],
    matches: [],
    blockedUsers: [],
    tabSwipeStyle: "",
    operatingId: "",
    showBlocked: false,
    friendsExpanded: true,
    greetingsExpanded: true,
    friendHasMore: false,
    friendCursor: "",
    greetingHasMore: false,
    greetingCursor: "",
    loadingMoreSection: ""
  },

  onShow() {
    tabSwipe.enter(this, "/pages/partners/partners");
    this.loadEncounterSummary();
    this._pageActive = true;
    this._refreshDelay = ACTIVE_REFRESH_MS;
    this.setForegroundView("partners");
    this.stopRefreshTimer();
    this.loadInbox().finally(() => this.scheduleRefresh(ACTIVE_REFRESH_MS));
  },

  onHide() { this.leavePage(); },
  onUnload() { this.leavePage(); },
  onPullDownRefresh() { this.loadInbox(); },
  onTabSwipeStart(event) { tabSwipe.start(this, event); },
  onTabSwipeMove(event) { tabSwipe.move(this, event, "/pages/partners/partners"); },
  onTabSwipeEnd(event) { tabSwipe.end(this, event, "/pages/partners/partners"); },
  onTabSwipeCancel() { tabSwipe.cancel(this); },

  stopRefreshTimer() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = null;
  },

  scheduleRefresh(delay) {
    this.stopRefreshTimer();
    if (!this._pageActive) return;
    this._refreshTimer = setTimeout(async () => {
      const changed = await this.loadInbox(true);
      this._refreshDelay = changed
        ? ACTIVE_REFRESH_MS
        : Math.min(MAX_REFRESH_MS, Math.max(ACTIVE_REFRESH_MS, this._refreshDelay * 2));
      this.scheduleRefresh(this._refreshDelay);
    }, Math.max(ACTIVE_REFRESH_MS, Number(delay) || ACTIVE_REFRESH_MS));
  },

  leavePage() {
    this._pageActive = false;
    this.stopRefreshTimer();
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.clearSocialForegroundView === "function") {
      app.clearSocialForegroundView("partners");
    }
  },

  setForegroundView(value) {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.setSocialForegroundView === "function") {
      app.setSocialForegroundView(value);
    }
  },

  async loadInbox(silent, options) {
    if (this._loadingInbox) return false;
    this._loadingInbox = true;
    const source = options && typeof options === "object" ? options : {};
    const section = String(source.section || "all");
    const append = source.append === true;
    const beforeSignature = inboxSignature(this.data.greetings, this.data.matches);
    try {
      const blockedUsersRequest = silent
        ? Promise.resolve(null)
        : socialService.getBlockedUsers().catch(error => {
          console.warn("屏蔽列表加载失败：", error && error.message);
          return [];
        });
      const results = await Promise.all([
        socialService.getSocialInbox({
          section,
          cursor: source.cursor || "",
          pageSize: 20
        }),
        blockedUsersRequest
      ]);
      const inbox = results[0] || {};
      const freshGreetings = decorateItems(inbox.greetings, "createdAt");
      const freshMatches = decorateMatches(inbox.matches);
      const preserveLoaded = silent && !append;
      const greetings = section === "friends"
        ? this.data.greetings
        : (append || preserveLoaded
          ? mergeUnique(freshGreetings, this.data.greetings, "greetingId")
          : freshGreetings);
      const matches = section === "greetings"
        ? this.data.matches
        : (append || preserveLoaded
          ? decorateMatches(mergeUnique(freshMatches, this.data.matches, "conversationId"))
          : freshMatches);
      const blockedUsers = results[1] === null
        ? this.data.blockedUsers
        : decorateItems(results[1], "blockedAt");
      const pagination = inbox.pagination || {};
      const friendPage = pagination.friends || {};
      const greetingPage = pagination.greetings || {};
      const paginationData = {};
      if (section !== "greetings" && !preserveLoaded) {
        paginationData.friendHasMore = friendPage.hasMore === true;
        paginationData.friendCursor = String(friendPage.nextCursor || "");
      }
      if (section !== "friends" && !preserveLoaded) {
        paginationData.greetingHasMore = greetingPage.hasMore === true;
        paginationData.greetingCursor = String(greetingPage.nextCursor || "");
      }
      this.setData(Object.assign({ greetings, matches, blockedUsers, loading: false }, paginationData));
      this.resolveInboxAvatars({ greetings, matches, blockedUsers });
      updateBadge(greetings, matches);
      return beforeSignature !== inboxSignature(freshGreetings, freshMatches);
    } catch (error) {
      this.setData({ loading: false });
      if (!silent) wx.showToast({ title: error.message || "伙伴消息加载失败", icon: "none" });
      return false;
    } finally {
      this._loadingInbox = false;
      wx.stopPullDownRefresh();
    }
  },

  async loadMore(event) {
    const section = String(event.currentTarget.dataset.section || "");
    const cursor = section === "friends" ? this.data.friendCursor : this.data.greetingCursor;
    if (!cursor || this.data.loadingMoreSection) return;
    this.setData({ loadingMoreSection: section });
    try {
      await this.loadInbox(true, { section, cursor, append: true });
    } finally {
      this.setData({ loadingMoreSection: "" });
    }
  },

  toggleBlocked() {
    this.setData({ showBlocked: !this.data.showBlocked });
  },

  resolveInboxAvatars(groups) {
    const source = groups && typeof groups === "object" ? groups : {};
    Object.keys(INBOX_AVATAR_KEYS).forEach(listName => {
      const idKey = INBOX_AVATAR_KEYS[listName];
      (Array.isArray(source[listName]) ? source[listName] : []).forEach(item => {
        const profile = item && item.profile;
        if (!profile || profile.avatarType !== "custom" || !profile.avatarValue) return;
        this.resolveInboxAvatar(listName, idKey, String(item[idKey] || ""), profile);
      });
    });
  },

  async resolveInboxAvatar(listName, idKey, itemId, profileValue, force) {
    const expectedFileId = String(profileValue && profileValue.avatarValue || "");
    if (!expectedFileId || !itemId) return;
    try {
      const profile = await socialAvatar.resolveDisplayProfile(profileValue, { force: force === true });
      this.updateInboxAvatar(listName, idKey, itemId, expectedFileId, {
        avatarDisplayUrl: profile.avatarDisplayUrl,
        avatarFallback: profile.avatarFallback,
        avatarFailed: false
      });
    } catch (error) {
      console.warn("伙伴列表头像地址解析失败：", error && error.message);
      this.updateInboxAvatar(listName, idKey, itemId, expectedFileId, { avatarFailed: true });
    }
  },

  updateInboxAvatar(listName, idKey, itemId, expectedFileId, values) {
    const items = Array.isArray(this.data[listName]) ? this.data[listName] : [];
    const index = items.findIndex(item => String(item && item[idKey] || "") === itemId);
    const current = index >= 0 ? items[index] : null;
    if (!current || String(current.profile && current.profile.avatarValue || "") !== expectedFileId) return;
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(values, "avatarDisplayUrl")) {
      updates[`${listName}[${index}].profile.avatarDisplayUrl`] = values.avatarDisplayUrl;
    }
    if (Object.prototype.hasOwnProperty.call(values, "avatarFallback")) {
      updates[`${listName}[${index}].profile.avatarFallback`] = values.avatarFallback;
    }
    updates[`${listName}[${index}].avatarFailed`] = values.avatarFailed === true;
    this.setData(updates);
  },

  handleInboxAvatarError(event) {
    const listName = String(event.currentTarget.dataset.list || "");
    const itemId = String(event.currentTarget.dataset.id || "");
    const idKey = INBOX_AVATAR_KEYS[listName];
    const items = Array.isArray(this.data[listName]) ? this.data[listName] : [];
    const item = idKey ? items.find(value => String(value && value[idKey] || "") === itemId) : null;
    const profile = item && item.profile;
    if (!profile) return;
    if (socialAvatar.isCloudFileId(profile.avatarValue)) {
      this.resolveInboxAvatar(listName, idKey, itemId, profile, true);
      return;
    }
    this.updateInboxAvatar(listName, idKey, itemId, String(profile.avatarValue || ""), {
      avatarFailed: true
    });
  },

  toggleSection(event) {
    const section = String(event.currentTarget.dataset.section || "");
    if (section === "friends") {
      this.setData({ friendsExpanded: !this.data.friendsExpanded });
    } else if (section === "greetings") {
      this.setData({ greetingsExpanded: !this.data.greetingsExpanded });
    }
  },

  async respondGreeting(event) {
    const greetingId = String(event.currentTarget.dataset.id || "");
    const accept = event.currentTarget.dataset.accept === true ||
      event.currentTarget.dataset.accept === "true";
    if (!greetingId || this.data.operatingId) return;
    this.setData({ operatingId: greetingId });
    try {
      await socialService.respondGreeting(greetingId, accept);
      wx.showToast({
        title: accept ? "你们已经互相认识啦" : "已忽略这条招呼",
        icon: accept ? "success" : "none"
      });
      this.setData({
        greetings: this.data.greetings.filter(item => item.greetingId !== greetingId)
      });
      await this.loadInbox(true);
      this._refreshDelay = ACTIVE_REFRESH_MS;
      this.scheduleRefresh(ACTIVE_REFRESH_MS);
    } catch (error) {
      wx.showToast({ title: error.message || "招呼处理失败", icon: "none" });
    } finally {
      this.setData({ operatingId: "" });
    }
  },

  openConversation(event) {
    this.openConversationById(event.currentTarget.dataset.id);
  },

  openAiChat() {
    wx.navigateTo({ url: "/pages/chat/chat" });
  },

  loadEncounterSummary() {
    const records = deviceService.getEncounterRecords();
    const encounterCount = records.reduce((total, item) => {
      return total + Math.max(1, Number(item.encounterCount) || 1);
    }, 0);
    this.setData({ encounterCount });
  },

  openEncounters() {
    wx.navigateTo({ url: "/pages/encounters/encounters" });
  },

  openConversationById(value) {
    const conversationId = String(value || "");
    if (!conversationId) {
      wx.showToast({ title: "会话正在同步，请稍后重试", icon: "none" });
      return;
    }
    wx.navigateTo({
      url: `/pages/social-chat/social-chat?conversationId=${encodeURIComponent(conversationId)}`
    });
  },

  async unblock(event) {
    const blockId = String(event.currentTarget.dataset.id || "");
    if (!blockId || this.data.operatingId) return;
    this.setData({ operatingId: blockId });
    try {
      await socialService.unblockUser(blockId);
      wx.showToast({ title: "已解除屏蔽", icon: "success" });
      await this.loadInbox(true);
    } catch (error) {
      wx.showToast({ title: error.message || "解除屏蔽失败", icon: "none" });
    } finally {
      this.setData({ operatingId: "" });
    }
  }
});

function decorateItems(items, timeField) {
  return (Array.isArray(items) ? items : []).map(item => Object.assign({}, item, {
    profile: item.profile ? socialAvatar.toDisplayProfile(item.profile) : null,
    avatarFailed: false,
    timeText: formatTime(item[timeField])
  }));
}

function decorateMatches(items) {
  return (Array.isArray(items) ? items : []).map(item => {
    const unreadCount = Math.max(0, Number(item.unreadCount) || 0);
    return Object.assign({}, item, {
      profile: socialAvatar.toDisplayProfile(item.profile),
      avatarFailed: false,
      unreadCount,
      hasNotice: item.newMatch || unreadCount > 0 || Boolean(item.contactNotice),
      unreadText: unreadCount > 99 ? "99+" : String(unreadCount),
      timeText: formatTime(item.activityAt || item.lastMessageAt || item.matchedAt),
      summary: item.newMatch
        ? "TA 接受了你的招呼"
        : (contactNoticeText(item.contactNotice) || item.lastMessagePreview || "你们已经认识啦，发一句问候吧")
    });
  }).sort((a, b) => {
    const first = Number(a.activityAt || a.lastMessageAt || a.matchedAt) || 0;
    const second = Number(b.activityAt || b.lastMessageAt || b.matchedAt) || 0;
    return second - first;
  });
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
  return result;
}

function inboxSignature(greetings, matches) {
  const greetingPart = (Array.isArray(greetings) ? greetings : []).slice(0, 20)
    .map(item => `${item.greetingId}:${item.createdAt}`).join("|");
  const matchPart = (Array.isArray(matches) ? matches : []).slice(0, 20)
    .map(item => [
      item.conversationId,
      item.unreadCount,
      item.newMatch ? 1 : 0,
      item.contactNotice || "",
      item.lastMessageAt || 0
    ].join(":"))
    .join("|");
  return `${greetingPart}#${matchPart}`;
}

function updateBadge(greetings, matches) {
  const count = greetings.length + matches.reduce((total, item) => (
    total + item.unreadCount + (item.newMatch && item.unreadCount === 0 ? 1 : 0) +
      (item.contactNotice && !item.newMatch ? 1 : 0)
  ), 0);
  const app = typeof getApp === "function" ? getApp() : null;
  if (app && typeof app.setSocialBadgeCount === "function") app.setSocialBadgeCount(count);
}

function contactNoticeText(value) {
  return {
    requested: "TA 想和你交换联系方式",
    accepted: "TA 已同意交换联系方式",
    declined: "TA 暂未同意交换联系方式",
    contact_updated: "TA 分享了联系方式",
    contact_withdrawn: "TA 撤回了联系方式"
  }[value] || "";
}

const INBOX_AVATAR_KEYS = Object.freeze({
  greetings: "greetingId",
  matches: "conversationId",
  blockedUsers: "blockId"
});

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

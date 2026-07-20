const INBOX_PAGE_SIZE = 20;
const INBOX_PAGE_SIZE_MAX = 50;

function socialInboxSortKey(timestamp, documentId) {
  const safeTimestamp = Math.max(0, Math.floor(Number(timestamp) || Date.now()));
  return `${String(safeTimestamp).padStart(13, "0")}:${String(documentId || "")}`;
}

function createSocialInbox(deps) {
  const {
    db, command, collections, readDocument, readDocuments, ensureConversation,
    isBlockedBetween, greetingDocumentId, matchDocumentId, toPublicProfile,
    normalizeContactNotice, withoutDocumentId, publicError
  } = deps;

  return async function getSocialInbox(ownerKey, options) {
    const source = options && typeof options === "object" ? options : {};
    const section = ["all", "friends", "greetings"].includes(source.section) ? source.section : "all";
    const cursor = normalizeInboxCursor(source.cursor, publicError);
    const pageSize = normalizeInboxPageSize(source.pageSize);
    await backfillOwnerInboxSortKeys(ownerKey, section);
    const greetingPage = section === "friends" ? emptyInboxPage() : await readInboxPage(
      collections.greetings, { recipientOwnerKey: ownerKey, status: "pending" }, cursor, pageSize
    );
    const matchPage = section === "greetings" ? emptyInboxPage() : await readInboxPage(
      collections.matches, { ownerKey }, cursor, pageSize
    );
    const greetings = (await Promise.all(greetingPage.records.map(async record => {
      const profile = await readDocument(collections.profiles, record.senderOwnerKey);
      return profile ? {
        greetingId: record._id || greetingDocumentId(record.senderOwnerKey, ownerKey),
        createdAt: Number(record.createdAt) || 0,
        profile: toPublicProfile(profile)
      } : null;
    }))).filter(Boolean);
    const matches = (await Promise.all(matchPage.records.map(async record => {
      if (await isBlockedBetween(ownerKey, record.peerOwnerKey)) return null;
      const profile = await readDocument(collections.profiles, record.peerOwnerKey);
      const conversationId = record.conversationId || await ensureConversation(ownerKey, record.peerOwnerKey, record.matchedAt);
      return profile ? {
        matchId: record._id || matchDocumentId(ownerKey, record.peerOwnerKey), conversationId,
        matchedAt: Number(record.matchedAt) || 0,
        activityAt: Number(String(record.inboxSortKey || "").slice(0, 13)) || 0,
        newMatch: record.newMatch === true,
        unreadCount: Math.max(0, Number(record.unreadCount) || 0),
        contactNotice: normalizeContactNotice(record.contactNotice),
        lastMessagePreview: String(record.lastMessagePreview || ""),
        lastMessageAt: Number(record.lastMessageAt) || 0,
        profile: toPublicProfile(profile)
      } : null;
    }))).filter(Boolean);
    return {
      greetings, matches,
      pagination: {
        greetings: { hasMore: greetingPage.hasMore, nextCursor: greetingPage.nextCursor },
        friends: { hasMore: matchPage.hasMore, nextCursor: matchPage.nextCursor }
      }
    };
  };

  async function readInboxPage(collectionName, equalityQuery, cursor, pageSize) {
    const query = Object.assign({}, equalityQuery);
    if (cursor) query.inboxSortKey = command.lt(cursor);
    const response = await db.collection(collectionName).where(query)
      .orderBy("inboxSortKey", "desc").limit(pageSize + 1).get();
    const records = response && Array.isArray(response.data) ? response.data : [];
    const hasMore = records.length > pageSize;
    const pageRecords = records.slice(0, pageSize);
    const last = pageRecords[pageRecords.length - 1];
    return { records: pageRecords, hasMore, nextCursor: hasMore && last ? String(last.inboxSortKey || "") : "" };
  }

  async function backfillOwnerInboxSortKeys(ownerKey, section) {
    const profile = await readDocument(collections.profiles, ownerKey);
    const jobs = [];
    const needsGreetings = section !== "friends" && (!profile || profile.inboxGreetingSortVersion !== 1);
    const needsMatches = section !== "greetings" && (!profile || profile.inboxMatchSortVersion !== 1);
    if (needsGreetings) jobs.push(backfillInboxCollection(collections.greetings, {
      recipientOwnerKey: ownerKey, status: "pending"
    }, record => Number(record.createdAt) || Number(record.updatedAt) || Date.now()));
    if (needsMatches) jobs.push(backfillInboxCollection(collections.matches, { ownerKey }, record => (
      Number(record.lastMessageAt) || Number(record.matchedAt) || Number(record.updatedAt) || Date.now()
    )));
    if (!jobs.length) return;
    const results = await Promise.all(jobs);
    const markerData = {};
    let index = 0;
    if (needsGreetings) { if (results[index] < 100) markerData.inboxGreetingSortVersion = 1; index += 1; }
    if (needsMatches && results[index] < 100) markerData.inboxMatchSortVersion = 1;
    if (Object.keys(markerData).length && profile) {
      await db.collection(collections.profiles).doc(ownerKey).set({ data: Object.assign({}, withoutDocumentId(profile), markerData) });
    }
  }

  async function backfillInboxCollection(collectionName, query, timestampForRecord) {
    const records = await readDocuments(collectionName, query, 100);
    await Promise.all(records.filter(record => !record.inboxSortKey).map(record => {
      const documentId = String(record._id || "");
      if (!/^[a-f0-9]{64}$/.test(documentId)) return Promise.resolve();
      return db.collection(collectionName).doc(documentId).set({ data: Object.assign({}, withoutDocumentId(record), {
        inboxSortKey: socialInboxSortKey(timestampForRecord(record), documentId)
      }) });
    }));
    return records.length;
  }
}

function emptyInboxPage() { return { records: [], hasMore: false, nextCursor: "" }; }
function normalizeInboxPageSize(value) { return Math.max(1, Math.min(INBOX_PAGE_SIZE_MAX, Math.floor(Number(value) || INBOX_PAGE_SIZE))); }
function normalizeInboxCursor(value, publicError) {
  const cursor = String(value || "").trim();
  if (!cursor) return "";
  if (!/^\d{13}:[a-f0-9]{64}$/.test(cursor)) throw publicError(400, "伙伴列表分页位置无效");
  return cursor;
}

module.exports = { createSocialInbox, socialInboxSortKey };

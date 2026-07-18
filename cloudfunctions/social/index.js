const cloud = require("wx-server-sdk");
const crypto = require("crypto");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;

const PROFILE_COLLECTION = "social_profiles";
const TOKEN_COLLECTION = "social_tokens";
const RESOLVE_USAGE_COLLECTION = "social_resolve_usage";
const ENCOUNTER_REF_COLLECTION = "social_encounter_refs";
const GREETING_COLLECTION = "social_greetings";
const MATCH_COLLECTION = "social_matches";
const CONVERSATION_COLLECTION = "social_conversations";
const MESSAGE_COLLECTION = "social_messages";
const CONTACT_REQUEST_COLLECTION = "social_contact_requests";
const CONTACT_COLLECTION = "social_contacts";
const CONTACT_FILE_COLLECTION = "social_contact_files";
const BLOCK_COLLECTION = "social_blocks";
const REPORT_COLLECTION = "social_reports";
// 离线相遇事件可能数天后才由挂件补发，旧 Token 映射保留 7 天用于解析。
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const INTERACTION_TTL_MS = TOKEN_TTL_MS;
const RESOLVE_LIMIT_PER_MINUTE = 30;
const MESSAGE_LIMIT_PER_MINUTE = 12;
const MESSAGE_LIMIT_PER_DAY = 200;
const GREETING_PRE_REPLY_MESSAGE_LIMIT = 3;
const CONTACT_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const CONTACT_STAGE_TTL_MS = 24 * 60 * 60 * 1000;
const INTENTIONS = new Set(["chat", "buddy", "quiet"]);
const REPORT_REASONS = new Set(["spam", "harassment", "fraud", "inappropriate", "other"]);
const SOLO_TEST_ACTIONS = new Set(["message", "request_contact", "accept_contact", "share_contact"]);
const MESSAGE_PAGE_SIZE = 30;
const MESSAGE_PAGE_SIZE_MAX = 50;
const INBOX_PAGE_SIZE = 20;
const INBOX_PAGE_SIZE_MAX = 50;

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
      return success({ profile: record ? toPrivateProfile(record) : null });
    }
    if (action === "registerToken") {
      const profile = await readDocument(PROFILE_COLLECTION, ownerKey);
      if (!profile) throw publicError(409, "请先保存社交名片");
      const token = normalizeToken(safeEvent.token);
      const now = Date.now();
      const tokenId = tokenDocumentId(context.APPID || "yuntuan", token);
      await registerTokenOwner(tokenId, ownerKey, now);
      return success({ registered: true, expiresAt: now + TOKEN_TTL_MS });
    }
    if (action === "prepareSoloTestPartner") {
      const profile = await readDocument(PROFILE_COLLECTION, ownerKey);
      if (!profile) throw publicError(409, "请先保存自己的社交名片");
      return success(await prepareSoloTestPartner(ownerKey, context.APPID || "yuntuan"));
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
      if (await isBlockedBetween(ownerKey, mapping.ownerKey)) {
        return success({ profile: null, reason: "not_found" });
      }
      const profile = await readDocument(PROFILE_COLLECTION, mapping.ownerKey);
      if (!profile) return success({ profile: null, reason: "not_found" });
      if (profile.soloTestForOwnerKey && profile.soloTestForOwnerKey !== ownerKey) {
        return success({ profile: null, reason: "not_found" });
      }
      const interactionRef = await createEncounterReference(ownerKey, mapping.ownerKey);
      return success({ profile: toPublicProfile(profile), interactionRef });
    }
    if (action === "sendGreeting") {
      return success(await sendGreetingWithSoloTest(ownerKey, safeEvent.interactionRef));
    }
    if (action === "getSocialInbox") {
      return success(await getSocialInbox(ownerKey, safeEvent));
    }
    if (action === "respondGreeting") {
      return success(await respondGreeting(ownerKey, safeEvent.greetingId, safeEvent.accept));
    }
    if (action === "getConversation") {
      return success(await getConversation(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.beforeCreatedAt,
        safeEvent.pageSize
      ));
    }
    if (action === "sendSocialMessage") {
      return success(await sendSocialMessage(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.content,
        safeEvent.requestId
      ));
    }
    if (action === "soloTestPeerAction") {
      return success(await runSoloTestPeerAction(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.testAction
      ));
    }
    if (action === "requestContactExchange") {
      return success(await requestContactExchange(ownerKey, safeEvent.conversationId));
    }
    if (action === "respondContactExchange") {
      return success(await respondContactExchange(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.accept
      ));
    }
    if (action === "cancelContactExchange") {
      return success(await cancelContactExchange(ownerKey, safeEvent.conversationId));
    }
    if (action === "getContactExchange") {
      return success(await getContactExchange(ownerKey, safeEvent.conversationId));
    }
    if (action === "stageContactQr") {
      return success(await stageContactQr(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.optionId,
        safeEvent.fileId,
        safeEvent.requestId
      ));
    }
    if (action === "cancelStagedContactShare") {
      return success(await cancelStagedContactShare(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.requestId
      ));
    }
    if (action === "shareContact") {
      return success(await shareContact(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.contactItems,
        safeEvent.requestId
      ));
    }
    if (action === "withdrawContact") {
      return success(await withdrawContact(ownerKey, safeEvent.conversationId));
    }
    if (action === "clearConversationForMe") {
      return success(await clearConversationForMe(ownerKey, safeEvent.conversationId));
    }
    if (action === "endRelationship") {
      return success(await endRelationship(ownerKey, safeEvent.conversationId));
    }
    if (action === "blockUser") {
      return success(await blockUser(ownerKey, safeEvent.conversationId));
    }
    if (action === "getBlockedUsers") {
      return success({ blockedUsers: await getBlockedUsers(ownerKey) });
    }
    if (action === "unblockUser") {
      return success(await unblockUser(ownerKey, safeEvent.blockId));
    }
    if (action === "reportMessage") {
      return success(await reportMessage(
        ownerKey,
        safeEvent.conversationId,
        safeEvent.messageId,
        safeEvent.reason,
        safeEvent.note
      ));
    }
    if (action === "deleteMyData") {
      return success(await deleteMyData(ownerKey));
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
  if (previous && previous.inboxGreetingSortVersion === 1) record.inboxGreetingSortVersion = 1;
  if (previous && previous.inboxMatchSortVersion === 1) record.inboxMatchSortVersion = 1;
  await db.collection(PROFILE_COLLECTION).doc(ownerKey).set({ data: record });

  const oldAvatar = previous && previous.avatarType === "custom" ? previous.avatarValue : "";
  if (oldAvatar && oldAvatar !== profile.avatarValue && isManagedAvatar(oldAvatar)) {
    try {
      await cloud.deleteFile({ fileList: [oldAvatar] });
    } catch (error) {
      console.warn("旧社交头像删除失败：", error && (error.errMsg || error.message));
    }
  }
  // 旧版本曾把未分享的二维码预设存进名片；新版保存时会清理这些遗留引用。
  const removedQrIds = profileContactQrIds(previous);
  await Promise.all(removedQrIds.map(fileId => releaseProfileContactQr(ownerKey, fileId)));
  return toPrivateProfile(record);
}

async function createEncounterReference(requesterOwnerKey, targetOwnerKey) {
  const referenceId = crypto.randomBytes(24).toString("hex");
  const now = Date.now();
  await db.collection(ENCOUNTER_REF_COLLECTION).doc(referenceId).set({
    data: {
      requesterOwnerKey,
      targetOwnerKey,
      expiresAt: now + INTERACTION_TTL_MS,
      createdAt: now
    }
  });
  return referenceId;
}

async function prepareSoloTestPartner(ownerKey, appid) {
  const peerOwnerKey = soloTestPeerOwnerKey(ownerKey);
  const now = Date.now();
  const profile = {
    ownerKey: peerOwnerKey,
    avatarType: "virtual",
    avatarValue: "测",
    avatarColor: "#DCEBE5",
    nickname: "云团测试伙伴",
    bio: "仅供单人调试，不对应真实用户。",
    tags: ["单人调试", "散步", "音乐"],
    intention: "chat",
    soloTestForOwnerKey: ownerKey,
    updatedAt: now
  };
  await db.collection(PROFILE_COLLECTION).doc(peerOwnerKey).set({ data: profile });
  await Promise.all([
    removeDocument(BLOCK_COLLECTION, blockDocumentId(ownerKey, peerOwnerKey)),
    removeDocument(BLOCK_COLLECTION, blockDocumentId(peerOwnerKey, ownerKey))
  ]);

  let token = 0;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = parseInt(
      sha256(`solo-test-token:${appid}:${ownerKey}:${attempt}`).slice(0, 8),
      16
    ) >>> 0;
    if (!candidate) continue;
    const tokenId = tokenDocumentId(appid, candidate);
    const previous = await readDocument(TOKEN_COLLECTION, tokenId);
    if (previous && previous.ownerKey !== peerOwnerKey && previous.expiresAt > now) continue;
    await registerTokenOwner(tokenId, peerOwnerKey, now);
    token = candidate;
    break;
  }
  if (!token) throw publicError(503, "暂时无法创建测试伙伴，请稍后再试");
  return { token, profile: toPublicProfile(profile), expiresAt: now + TOKEN_TTL_MS };
}

async function sendGreetingWithSoloTest(ownerKey, interactionRef) {
  const result = await sendGreeting(ownerKey, interactionRef);
  if (result.matched || !result.greetingId) return result;
  const greeting = await readDocument(GREETING_COLLECTION, result.greetingId);
  if (!greeting || greeting.recipientOwnerKey !== soloTestPeerOwnerKey(ownerKey)) return result;
  const accepted = await respondGreeting(greeting.recipientOwnerKey, result.greetingId, true);
  return Object.assign({}, accepted, { soloTestAutoAccepted: true });
}

async function runSoloTestPeerAction(ownerKey, conversationValue, actionValue) {
  const action = String(actionValue || "").trim();
  if (!SOLO_TEST_ACTIONS.has(action)) throw publicError(400, "不支持的测试伙伴操作");
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  if (context.peerOwnerKey !== soloTestPeerOwnerKey(ownerKey)) {
    throw publicError(403, "只能控制当前账号自己的测试伙伴");
  }
  const peerOwnerKey = context.peerOwnerKey;
  if (action === "message") {
    const requestId = `solo_reply_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
    const result = await sendSocialMessage(
      peerOwnerKey,
      context.conversationId,
      "你好呀，我是你的云团测试伙伴 👋",
      requestId
    );
    return { action, message: Object.assign({}, result.message, { sender: "peer" }) };
  }
  if (action === "request_contact") {
    return Object.assign({ action }, await requestContactExchange(peerOwnerKey, context.conversationId));
  }
  if (action === "accept_contact") {
    return Object.assign(
      { action },
      await respondContactExchange(peerOwnerKey, context.conversationId, true)
    );
  }
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, context.conversationId);
  if (!request || request.status !== "accepted") {
    throw publicError(409, "请先让双方同意交换联系方式");
  }
  return Object.assign(
    { action },
    await shareContact(peerOwnerKey, context.conversationId, [{
      id: "solo_wechat",
      type: "wechat",
      label: "测试微信号",
      value: "YunTuan-Test"
    }], `solo_share_${context.conversationId.slice(0, 48)}`)
  );
}

async function sendGreeting(ownerKey, referenceValue) {
  const referenceId = normalizeOpaqueId(referenceValue, 48, "相遇互动凭证无效");
  const reference = await readDocument(ENCOUNTER_REF_COLLECTION, referenceId);
  if (!reference || reference.requesterOwnerKey !== ownerKey || reference.expiresAt <= Date.now()) {
    throw publicError(410, "这次相遇的互动期限已过，请下次见面时再打招呼");
  }
  const targetOwnerKey = reference.targetOwnerKey;
  if (!targetOwnerKey || targetOwnerKey === ownerKey) throw publicError(400, "不能给自己打招呼");
  if (await isBlockedBetween(ownerKey, targetOwnerKey)) {
    throw publicError(403, "当前无法向对方发送招呼");
  }
  const targetProfile = await readDocument(PROFILE_COLLECTION, targetOwnerKey);
  if (!targetProfile) throw publicError(404, "对方的社交名片已不可用");
  if (targetProfile.intention === "quiet") throw publicError(409, "对方现在暂不接收招呼");

  const existingMatch = await readDocument(MATCH_COLLECTION, matchDocumentId(ownerKey, targetOwnerKey));
  if (existingMatch) {
    const conversationId = await ensureConversation(ownerKey, targetOwnerKey, existingMatch.matchedAt);
    return { status: "matched", matched: true, conversationId };
  }

  const greetingId = greetingDocumentId(ownerKey, targetOwnerKey);
  const previousGreeting = await readDocument(GREETING_COLLECTION, greetingId);
  if (previousGreeting && previousGreeting.status === "pending") {
    return { greetingId, status: "sent", matched: false };
  }
  if (previousGreeting && previousGreeting.status === "accepted") {
    const oldConversation = await readDocument(
      CONVERSATION_COLLECTION,
      conversationDocumentId(ownerKey, targetOwnerKey)
    );
    if (oldConversation && oldConversation.status === "ended") {
      const now = Date.now();
      await db.collection(GREETING_COLLECTION).doc(greetingId).set({
        data: Object.assign({}, withoutDocumentId(previousGreeting), {
          status: "pending",
          createdAt: now,
          inboxSortKey: socialInboxSortKey(now, greetingId),
          updatedAt: now,
          respondedAt: 0
        })
      });
      return { greetingId, status: "sent", matched: false };
    }
    const conversationId = await createMatchPair(
      ownerKey,
      targetOwnerKey,
      Number(previousGreeting.respondedAt) || Date.now(),
      ownerKey,
      false
    );
    return { greetingId, status: "matched", matched: true, conversationId };
  }
  if (previousGreeting && previousGreeting.status === "declined") {
    throw publicError(409, "对方暂未接受这次招呼，请尊重对方的选择");
  }
  const now = Date.now();
  await db.collection(GREETING_COLLECTION).doc(greetingId).set({
    data: {
      senderOwnerKey: ownerKey,
      recipientOwnerKey: targetOwnerKey,
      status: "pending",
      createdAt: now,
      inboxSortKey: socialInboxSortKey(now, greetingId),
      updatedAt: now
    }
  });
  return { greetingId, status: "sent", matched: false };
}

async function respondGreeting(ownerKey, greetingValue, acceptValue) {
  const greetingId = normalizeOpaqueId(greetingValue, 64, "招呼编号无效");
  const greeting = await readDocument(GREETING_COLLECTION, greetingId);
  if (!greeting || greeting.recipientOwnerKey !== ownerKey) {
    throw publicError(404, "这条招呼不存在或已失效");
  }
  if (greeting.status !== "pending") {
    let conversationId = "";
    if (greeting.status === "accepted") {
      conversationId = await createMatchPair(
        ownerKey,
        greeting.senderOwnerKey,
        Number(greeting.respondedAt) || Date.now(),
        greeting.senderOwnerKey,
        false
      );
    }
    return {
      greetingId,
      status: greeting.status,
      matched: greeting.status === "accepted",
      conversationId
    };
  }
  const accept = acceptValue === true;
  const now = Date.now();
  const conversationId = accept
    ? await createMatchPair(ownerKey, greeting.senderOwnerKey, now, greeting.senderOwnerKey, true)
    : "";
  await db.collection(GREETING_COLLECTION).doc(greetingId).set({
    data: Object.assign({}, withoutDocumentId(greeting), {
      status: accept ? "accepted" : "declined",
      respondedAt: now,
      updatedAt: now
    })
  });
  if (!accept) return { greetingId, status: "declined", matched: false };

  const profile = await readDocument(PROFILE_COLLECTION, greeting.senderOwnerKey);
  return {
    greetingId,
    status: "accepted",
    matched: true,
    conversationId,
    profile: profile ? toPublicProfile(profile) : null
  };
}

async function createMatchPair(firstOwnerKey, secondOwnerKey, matchedAt, noticeOwnerKey, allowReactivate) {
  if (await isBlockedBetween(firstOwnerKey, secondOwnerKey)) {
    throw publicError(403, "当前无法建立伙伴关系");
  }
  const safeMatchedAt = Number(matchedAt) || Date.now();
  const conversationId = await ensureConversation(firstOwnerKey, secondOwnerKey, safeMatchedAt);
  let conversation = await readDocument(CONVERSATION_COLLECTION, conversationId);
  const wasEnded = Boolean(conversation && conversation.status === "ended");
  if (wasEnded && !allowReactivate) {
    throw publicError(409, "伙伴关系已经解除，需要重新发送并接受招呼");
  }
  if (wasEnded) {
    const reactivated = Object.assign({}, withoutDocumentId(conversation), {
      status: "active",
      reactivatedAt: safeMatchedAt,
      updatedAt: safeMatchedAt
    });
    delete reactivated.endedAt;
    delete reactivated.endedByOwnerKey;
    await db.collection(CONVERSATION_COLLECTION).doc(conversationId).set({ data: reactivated });
    conversation = reactivated;
  }
  const greetingInitiatorOwnerKey = [firstOwnerKey, secondOwnerKey].includes(noticeOwnerKey)
    ? noticeOwnerKey
    : "";
  if (
    greetingInitiatorOwnerKey &&
    (wasEnded || !getGreetingInitiatorOwnerKey(conversation))
  ) {
    conversation = Object.assign({}, withoutDocumentId(conversation), {
      greetingInitiatorOwnerKey,
      greetingRecipientReplied: false,
      initiatorPreReplyCount: 0,
      updatedAt: safeMatchedAt
    });
    await db.collection(CONVERSATION_COLLECTION).doc(conversationId).set({ data: conversation });
  }
  const entries = [
    { ownerKey: firstOwnerKey, peerOwnerKey: secondOwnerKey },
    { ownerKey: secondOwnerKey, peerOwnerKey: firstOwnerKey }
  ];
  await Promise.all(entries.map(async entry => {
    const documentId = matchDocumentId(entry.ownerKey, entry.peerOwnerKey);
    const previous = await readDocument(MATCH_COLLECTION, documentId);
    const record = Object.assign({
      ownerKey: entry.ownerKey,
      peerOwnerKey: entry.peerOwnerKey,
      matchedAt: safeMatchedAt,
      conversationId,
      newMatch: entry.ownerKey === noticeOwnerKey,
      unreadCount: 0,
      lastMessagePreview: "",
      lastMessageAt: 0,
      lastUnreadMessageId: "",
      contactNotice: "",
      clearedBeforeAt: wasEnded ? safeMatchedAt : 0,
      updatedAt: safeMatchedAt
    }, previous ? withoutDocumentId(previous) : {}, {
      ownerKey: entry.ownerKey,
      peerOwnerKey: entry.peerOwnerKey,
      conversationId,
      matchedAt: Number(previous && previous.matchedAt) || safeMatchedAt,
      clearedBeforeAt: wasEnded
        ? safeMatchedAt
        : Math.max(0, Number(previous && previous.clearedBeforeAt) || 0),
      inboxSortKey: socialInboxSortKey(Date.now(), documentId),
      updatedAt: Date.now()
    });
    await db.collection(MATCH_COLLECTION).doc(documentId).set({ data: record });
  }));
  return conversationId;
}

async function getSocialInbox(ownerKey, options) {
  const source = options && typeof options === "object" ? options : {};
  const section = ["all", "friends", "greetings"].includes(source.section)
    ? source.section
    : "all";
  const cursor = normalizeInboxCursor(source.cursor);
  const pageSize = normalizeInboxPageSize(source.pageSize);
  await backfillOwnerInboxSortKeys(ownerKey, section);

  const greetingPage = section === "friends"
    ? emptyInboxPage()
    : await readInboxPage(GREETING_COLLECTION, {
      recipientOwnerKey: ownerKey,
      status: "pending"
    }, cursor, pageSize);
  const matchPage = section === "greetings"
    ? emptyInboxPage()
    : await readInboxPage(MATCH_COLLECTION, { ownerKey }, cursor, pageSize);

  const greetings = (await Promise.all(greetingPage.records.map(async record => {
    const profile = await readDocument(PROFILE_COLLECTION, record.senderOwnerKey);
    return profile ? {
      greetingId: record._id || greetingDocumentId(record.senderOwnerKey, ownerKey),
      createdAt: Number(record.createdAt) || 0,
      profile: toPublicProfile(profile)
    } : null;
  }))).filter(Boolean);

  const matches = (await Promise.all(matchPage.records.map(async record => {
    if (await isBlockedBetween(ownerKey, record.peerOwnerKey)) return null;
    const profile = await readDocument(PROFILE_COLLECTION, record.peerOwnerKey);
    const conversationId = record.conversationId || await ensureConversation(
      ownerKey,
      record.peerOwnerKey,
      record.matchedAt
    );
    return profile ? {
      matchId: record._id || matchDocumentId(ownerKey, record.peerOwnerKey),
      conversationId,
      matchedAt: Number(record.matchedAt) || 0,
      activityAt: inboxTimestamp(record.inboxSortKey),
      newMatch: record.newMatch === true,
      unreadCount: Math.max(0, Number(record.unreadCount) || 0),
      contactNotice: normalizeContactNotice(record.contactNotice),
      lastMessagePreview: String(record.lastMessagePreview || ""),
      lastMessageAt: Number(record.lastMessageAt) || 0,
      profile: toPublicProfile(profile)
    } : null;
  }))).filter(Boolean);

  return {
    greetings,
    matches,
    pagination: {
      greetings: { hasMore: greetingPage.hasMore, nextCursor: greetingPage.nextCursor },
      friends: { hasMore: matchPage.hasMore, nextCursor: matchPage.nextCursor }
    }
  };
}

async function readInboxPage(collectionName, equalityQuery, cursor, pageSize) {
  const query = Object.assign({}, equalityQuery);
  if (cursor) query.inboxSortKey = command.lt(cursor);
  const response = await db.collection(collectionName)
    .where(query)
    .orderBy("inboxSortKey", "desc")
    .limit(pageSize + 1)
    .get();
  const records = response && Array.isArray(response.data) ? response.data : [];
  const hasMore = records.length > pageSize;
  const pageRecords = records.slice(0, pageSize);
  const last = pageRecords[pageRecords.length - 1];
  return {
    records: pageRecords,
    hasMore,
    nextCursor: hasMore && last ? String(last.inboxSortKey || "") : ""
  };
}

function emptyInboxPage() {
  return { records: [], hasMore: false, nextCursor: "" };
}

async function backfillOwnerInboxSortKeys(ownerKey, section) {
  const profile = await readDocument(PROFILE_COLLECTION, ownerKey);
  const jobs = [];
  const needsGreetings = section !== "friends" && (!profile || profile.inboxGreetingSortVersion !== 1);
  const needsMatches = section !== "greetings" && (!profile || profile.inboxMatchSortVersion !== 1);
  if (needsGreetings) {
    jobs.push(backfillInboxCollection(GREETING_COLLECTION, {
      recipientOwnerKey: ownerKey,
      status: "pending"
    }, record => Number(record.createdAt) || Number(record.updatedAt) || Date.now()));
  }
  if (needsMatches) {
    jobs.push(backfillInboxCollection(MATCH_COLLECTION, { ownerKey }, record => (
      Number(record.lastMessageAt) || Number(record.matchedAt) || Number(record.updatedAt) || Date.now()
    )));
  }
  if (!jobs.length) return;
  const results = await Promise.all(jobs);
  const markerData = {};
  let resultIndex = 0;
  if (needsGreetings) {
    if (results[resultIndex] < 100) markerData.inboxGreetingSortVersion = 1;
    resultIndex += 1;
  }
  if (needsMatches && results[resultIndex] < 100) markerData.inboxMatchSortVersion = 1;
  if (Object.keys(markerData).length && profile) {
    await db.collection(PROFILE_COLLECTION).doc(ownerKey).set({
      data: Object.assign({}, withoutDocumentId(profile), markerData)
    });
  }
}

async function backfillInboxCollection(collectionName, query, timestampForRecord) {
  const records = await readDocuments(collectionName, query, 100);
  await Promise.all(records.filter(record => !record.inboxSortKey).map(record => {
    const documentId = String(record._id || "");
    if (!/^[a-f0-9]{64}$/.test(documentId)) return Promise.resolve();
    return db.collection(collectionName).doc(documentId).set({
      data: Object.assign({}, withoutDocumentId(record), {
        inboxSortKey: socialInboxSortKey(timestampForRecord(record), documentId)
      })
    });
  }));
  return records.length;
}

function normalizeInboxPageSize(value) {
  const pageSize = Math.floor(Number(value) || INBOX_PAGE_SIZE);
  return Math.max(1, Math.min(INBOX_PAGE_SIZE_MAX, pageSize));
}

function normalizeInboxCursor(value) {
  const cursor = String(value || "").trim();
  if (!cursor) return "";
  if (!/^\d{13}:[a-f0-9]{64}$/.test(cursor)) {
    throw publicError(400, "伙伴列表分页位置无效");
  }
  return cursor;
}

function socialInboxSortKey(timestamp, documentId) {
  const safeTimestamp = Math.max(0, Math.floor(Number(timestamp) || Date.now()));
  return `${String(safeTimestamp).padStart(13, "0")}:${String(documentId || "")}`;
}

function inboxTimestamp(sortKey) {
  return Number(String(sortKey || "").slice(0, 13)) || 0;
}

async function ensureConversation(firstOwnerKey, secondOwnerKey, createdAtValue) {
  const members = [firstOwnerKey, secondOwnerKey].sort();
  const conversationId = conversationDocumentId(members[0], members[1]);
  const previous = await readDocument(CONVERSATION_COLLECTION, conversationId);
  if (!previous) {
    const createdAt = Number(createdAtValue) || Date.now();
    await db.collection(CONVERSATION_COLLECTION).doc(conversationId).set({
      data: {
        memberAOwnerKey: members[0],
        memberBOwnerKey: members[1],
        createdAt,
        updatedAt: createdAt,
        lastMessagePreview: "",
        lastMessageAt: 0,
        status: "active"
      }
    });
  }
  return conversationId;
}

function getGreetingInitiatorOwnerKey(conversation) {
  if (!conversation) return "";
  const ownerKey = String(conversation.greetingInitiatorOwnerKey || "");
  return ownerKey && (
    ownerKey === conversation.memberAOwnerKey ||
    ownerKey === conversation.memberBOwnerKey
  ) ? ownerKey : "";
}

async function resolveGreetingMessagePolicy(conversationId, conversation) {
  const storedInitiatorOwnerKey = getGreetingInitiatorOwnerKey(conversation);
  if (storedInitiatorOwnerKey) {
    return {
      greetingInitiatorOwnerKey: storedInitiatorOwnerKey,
      greetingRecipientReplied: conversation.greetingRecipientReplied === true,
      initiatorPreReplyCount: Math.max(0, Number(conversation.initiatorPreReplyCount) || 0)
    };
  }
  if (!conversation || !conversation.memberAOwnerKey || !conversation.memberBOwnerKey) return null;

  const greetingRecords = await Promise.all([
    readDocument(
      GREETING_COLLECTION,
      greetingDocumentId(conversation.memberAOwnerKey, conversation.memberBOwnerKey)
    ),
    readDocument(
      GREETING_COLLECTION,
      greetingDocumentId(conversation.memberBOwnerKey, conversation.memberAOwnerKey)
    )
  ]);
  const acceptedGreeting = greetingRecords
    .filter(record => record && record.status === "accepted")
    .sort((first, second) => (
      Number(second.respondedAt || second.updatedAt || second.createdAt) -
      Number(first.respondedAt || first.updatedAt || first.createdAt)
    ))[0];
  if (!acceptedGreeting) return null;

  // 兼容已经在线上创建、但还没有消息策略字段的旧会话。
  const legacyMessages = await readDocuments(MESSAGE_COLLECTION, { conversationId }, 100);
  const greetingRecipientReplied = legacyMessages.some(message => (
    message.senderOwnerKey === acceptedGreeting.recipientOwnerKey
  ));
  const initiatorPreReplyCount = legacyMessages.filter(message => (
    message.senderOwnerKey === acceptedGreeting.senderOwnerKey
  )).length;
  return {
    greetingInitiatorOwnerKey: acceptedGreeting.senderOwnerKey,
    greetingRecipientReplied,
    initiatorPreReplyCount
  };
}

function toPublicGreetingMessagePolicy(conversation, ownerKey) {
  const initiatorOwnerKey = getGreetingInitiatorOwnerKey(conversation);
  const peerHasReplied = conversation && conversation.greetingRecipientReplied === true;
  const isGreetingInitiator = Boolean(initiatorOwnerKey && initiatorOwnerKey === ownerKey);
  const sentCount = Math.max(0, Number(conversation && conversation.initiatorPreReplyCount) || 0);
  const limited = isGreetingInitiator && !peerHasReplied;
  return {
    limited,
    peerHasReplied,
    remainingBeforeReply: limited
      ? Math.max(0, GREETING_PRE_REPLY_MESSAGE_LIMIT - sentCount)
      : null
  };
}

async function getConversation(ownerKey, conversationValue, beforeValue, pageSizeValue) {
  const conversationId = normalizeOpaqueId(conversationValue, 64, "会话编号无效");
  let conversation = await readDocument(CONVERSATION_COLLECTION, conversationId);
  const peerOwnerKey = getConversationPeer(conversation, ownerKey);
  if (!peerOwnerKey) throw publicError(404, "这段伙伴会话不存在或无权查看");
  if (conversation.status === "ended") {
    throw publicError(409, "伙伴关系已解除，不能继续聊天");
  }
  if (await isBlockedBetween(ownerKey, peerOwnerKey)) {
    throw publicError(403, "当前无法查看这段会话");
  }

  const matchId = matchDocumentId(ownerKey, peerOwnerKey);
  const match = await readDocument(MATCH_COLLECTION, matchId);
  if (!match) throw publicError(403, "只有已经互相确认的伙伴可以聊天");
  const profile = await readDocument(PROFILE_COLLECTION, peerOwnerKey);
  if (!profile) throw publicError(404, "对方的社交名片已不可用");
  const greetingPolicy = await resolveGreetingMessagePolicy(conversationId, conversation);
  if (greetingPolicy) conversation = Object.assign({}, conversation, greetingPolicy);

  const clearedBeforeAt = Math.max(0, Number(match.clearedBeforeAt) || 0);
  const pageSize = normalizeMessagePageSize(pageSizeValue);
  const beforeCreatedAt = normalizeMessageCursor(beforeValue);
  const page = await readMessagePage(conversationId, clearedBeforeAt, beforeCreatedAt, pageSize);
  const messages = page.records
    .slice()
    .reverse()
    .map(record => toPublicMessage(record, ownerKey));

  if (!beforeCreatedAt && (
    match.newMatch === true ||
    (Number(match.unreadCount) || 0) > 0 ||
    normalizeContactNotice(match.contactNotice)
  )) {
    await db.collection(MATCH_COLLECTION).doc(matchId).set({
      data: Object.assign({}, withoutDocumentId(match), {
        newMatch: false,
        unreadCount: 0,
        contactNotice: "",
        updatedAt: Date.now()
      })
    });
  }
  return {
    conversation: {
      conversationId,
      matchedAt: Number(match.matchedAt) || Number(conversation.createdAt) || 0,
      profile: toPublicProfile(profile)
    },
    messages,
    pagination: {
      hasMore: page.hasMore,
      nextCursor: page.nextCursor
    },
    messagePolicy: toPublicGreetingMessagePolicy(conversation, ownerKey),
    contactExchange: await getContactExchangeState(ownerKey, peerOwnerKey, conversationId)
  };
}

async function sendSocialMessage(ownerKey, conversationValue, contentValue, requestValue) {
  const conversationId = normalizeOpaqueId(conversationValue, 64, "会话编号无效");
  const content = cleanMessageText(contentValue);
  const requestId = normalizeRequestId(requestValue);
  let conversation = await readDocument(CONVERSATION_COLLECTION, conversationId);
  const peerOwnerKey = getConversationPeer(conversation, ownerKey);
  if (!peerOwnerKey) throw publicError(404, "这段伙伴会话不存在或无权发送消息");
  if (conversation.status === "ended") {
    throw publicError(409, "伙伴关系已解除，不能继续发送消息");
  }
  if (await isBlockedBetween(ownerKey, peerOwnerKey)) {
    throw publicError(403, "当前无法向对方发送消息");
  }
  if (!await readDocument(MATCH_COLLECTION, matchDocumentId(ownerKey, peerOwnerKey))) {
    throw publicError(403, "只有已经互相确认的伙伴可以聊天");
  }
  const fallbackGreetingPolicy = await resolveGreetingMessagePolicy(conversationId, conversation);
  if (fallbackGreetingPolicy) conversation = Object.assign({}, conversation, fallbackGreetingPolicy);

  const messageId = sha256(`social-message:${conversationId}:${ownerKey}:${requestId}`);
  const result = await db.runTransaction(async transaction => {
    const messageReference = transaction.collection(MESSAGE_COLLECTION).doc(messageId);
    const previousMessage = await readTransactionDocument(messageReference);
    if (previousMessage) return previousMessage;

    const senderMatchReference = transaction.collection(MATCH_COLLECTION)
      .doc(matchDocumentId(ownerKey, peerOwnerKey));
    const recipientMatchReference = transaction.collection(MATCH_COLLECTION)
      .doc(matchDocumentId(peerOwnerKey, ownerKey));
    const conversationReference = transaction.collection(CONVERSATION_COLLECTION).doc(conversationId);
    const usageReference = transaction.collection(RESOLVE_USAGE_COLLECTION).doc(ownerKey);
    const senderMatch = await readTransactionDocument(senderMatchReference);
    const recipientMatch = await readTransactionDocument(recipientMatchReference);
    const transactionConversation = await readTransactionDocument(conversationReference);
    const usage = await readTransactionDocument(usageReference);
    if (!senderMatch || !recipientMatch || !transactionConversation) {
      throw publicError(409, "伙伴关系正在同步，请稍后重试");
    }
    if (transactionConversation.status === "ended") {
      throw publicError(409, "伙伴关系已解除，不能继续发送消息");
    }

    const storedInitiatorOwnerKey = getGreetingInitiatorOwnerKey(transactionConversation);
    const greetingPolicy = storedInitiatorOwnerKey
      ? {
        greetingInitiatorOwnerKey: storedInitiatorOwnerKey,
        greetingRecipientReplied: transactionConversation.greetingRecipientReplied === true,
        initiatorPreReplyCount: Math.max(0, Number(transactionConversation.initiatorPreReplyCount) || 0)
      }
      : fallbackGreetingPolicy;
    if (
      greetingPolicy &&
      ownerKey === greetingPolicy.greetingInitiatorOwnerKey &&
      !greetingPolicy.greetingRecipientReplied &&
      greetingPolicy.initiatorPreReplyCount >= GREETING_PRE_REPLY_MESSAGE_LIMIT
    ) {
      throw publicError(429, "对方回复前最多发送 3 条消息，请耐心等待对方回复");
    }

    const now = Math.max(
      Date.now(),
      Math.max(0, Number(transactionConversation.lastMessageAt) || 0) + 1
    );
    const minuteBucket = Math.floor(now / 60000);
    const dayKey = beijingDayKey(now);
    const minuteCount = usage && usage.messageMinuteBucket === minuteBucket
      ? Math.max(0, Number(usage.messageMinuteCount) || 0)
      : 0;
    const dayCount = usage && usage.messageDayKey === dayKey
      ? Math.max(0, Number(usage.messageDayCount) || 0)
      : 0;
    if (minuteCount >= MESSAGE_LIMIT_PER_MINUTE) {
      throw publicError(429, "消息发送太快了，请稍后再试");
    }
    if (dayCount >= MESSAGE_LIMIT_PER_DAY) {
      throw publicError(429, "今天发送的伙伴消息较多，请明天再试");
    }
    const message = {
      conversationId,
      senderOwnerKey: ownerKey,
      recipientOwnerKey: peerOwnerKey,
      content,
      createdAt: now
    };
    await messageReference.set({ data: message });
    await usageReference.set({
      data: Object.assign({}, withoutDocumentId(usage), {
        messageMinuteBucket: minuteBucket,
        messageMinuteCount: minuteCount + 1,
        messageDayKey: dayKey,
        messageDayCount: dayCount + 1,
        updatedAt: now
      })
    });
    const nextGreetingPolicy = greetingPolicy
      ? {
        greetingInitiatorOwnerKey: greetingPolicy.greetingInitiatorOwnerKey,
        greetingRecipientReplied: greetingPolicy.greetingRecipientReplied ||
          ownerKey !== greetingPolicy.greetingInitiatorOwnerKey,
        initiatorPreReplyCount: greetingPolicy.greetingRecipientReplied ||
          ownerKey !== greetingPolicy.greetingInitiatorOwnerKey
          ? greetingPolicy.initiatorPreReplyCount
          : greetingPolicy.initiatorPreReplyCount + 1
      }
      : {};
    await conversationReference.set({
      data: Object.assign({}, withoutDocumentId(transactionConversation), nextGreetingPolicy, {
        lastMessagePreview: content,
        lastMessageAt: now,
        updatedAt: now
      })
    });
    await senderMatchReference.set({
      data: Object.assign({}, withoutDocumentId(senderMatch), {
        conversationId,
        lastMessagePreview: content,
        lastMessageAt: now,
        inboxSortKey: socialInboxSortKey(now, matchDocumentId(ownerKey, peerOwnerKey)),
        updatedAt: now
      })
    });
    await recipientMatchReference.set({
      data: Object.assign({}, withoutDocumentId(recipientMatch), {
        conversationId,
        newMatch: false,
        unreadCount: Math.max(0, Number(recipientMatch.unreadCount) || 0) + 1,
        lastUnreadMessageId: messageId,
        lastMessagePreview: content,
        lastMessageAt: now,
        inboxSortKey: socialInboxSortKey(now, matchDocumentId(peerOwnerKey, ownerKey)),
        updatedAt: now
      })
    });
    return Object.assign({ _id: messageId }, message);
  }, 5);
  return { message: toPublicMessage(Object.assign({ _id: messageId }, result), ownerKey) };
}

async function requestContactExchange(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const previous = await readDocument(CONTACT_REQUEST_COLLECTION, context.conversationId);
  const now = Date.now();
  if (previous && previous.status === "accepted") {
    return { contactExchange: await getContactExchangeState(
      ownerKey,
      context.peerOwnerKey,
      context.conversationId
    ) };
  }
  if (previous && previous.status === "pending") {
    if (previous.requesterOwnerKey !== ownerKey) {
      throw publicError(409, "对方已经发来交换申请，请先选择同意或拒绝");
    }
    return { contactExchange: await getContactExchangeState(
      ownerKey,
      context.peerOwnerKey,
      context.conversationId
    ) };
  }
  if (
    previous &&
    previous.status === "declined" &&
    now - (Number(previous.updatedAt) || 0) < CONTACT_REQUEST_COOLDOWN_MS
  ) {
    throw publicError(429, "对方暂未同意，请过一段时间再申请");
  }

  await db.collection(CONTACT_REQUEST_COLLECTION).doc(context.conversationId).set({
    data: {
      conversationId: context.conversationId,
      requesterOwnerKey: ownerKey,
      recipientOwnerKey: context.peerOwnerKey,
      status: "pending",
      createdAt: now,
      updatedAt: now
    }
  });
  await updateMatchNotice(context.peerOwnerKey, ownerKey, "requested");
  return { contactExchange: await getContactExchangeState(
    ownerKey,
    context.peerOwnerKey,
    context.conversationId
  ) };
}

async function respondContactExchange(ownerKey, conversationValue, acceptValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, context.conversationId);
  if (!request || request.status !== "pending" || request.recipientOwnerKey !== ownerKey) {
    throw publicError(404, "这条联系方式交换申请不存在或已经处理");
  }
  const accept = acceptValue === true;
  const now = Date.now();
  await db.collection(CONTACT_REQUEST_COLLECTION).doc(context.conversationId).set({
    data: Object.assign({}, withoutDocumentId(request), {
      status: accept ? "accepted" : "declined",
      respondedAt: now,
      updatedAt: now
    })
  });
  await updateMatchNotice(request.requesterOwnerKey, ownerKey, accept ? "accepted" : "declined");
  await updateMatchNotice(ownerKey, context.peerOwnerKey, "");
  return { contactExchange: await getContactExchangeState(
    ownerKey,
    context.peerOwnerKey,
    context.conversationId
  ) };
}

async function cancelContactExchange(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, context.conversationId);
  if (!request || request.status !== "pending" || request.requesterOwnerKey !== ownerKey) {
    throw publicError(404, "当前没有可撤回的交换申请");
  }
  await db.collection(CONTACT_REQUEST_COLLECTION).doc(context.conversationId).set({
    data: Object.assign({}, withoutDocumentId(request), {
      status: "cancelled",
      updatedAt: Date.now()
    })
  });
  await updateMatchNotice(context.peerOwnerKey, ownerKey, "");
  return {
    cancelled: true,
    contactExchange: { status: "none", myContact: null, peerContact: null }
  };
}

async function getContactExchange(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  await cleanupExpiredStagedContactQrs(ownerKey);
  return {
    contactExchange: await getContactExchangeState(
      ownerKey,
      context.peerOwnerKey,
      context.conversationId
    )
  };
}

async function stageContactQr(ownerKey, conversationValue, optionValue, fileValue, requestValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  await assertAcceptedContactExchange(context.conversationId);
  const requestId = normalizeRequestId(requestValue);
  const optionId = String(optionValue || "").trim();
  const fileId = String(fileValue || "").trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(optionId) || !isManagedContactQr(fileId)) {
    throw publicError(400, "联系方式二维码信息无效");
  }
  await cleanupExpiredStagedContactQrs(ownerKey);
  const documentId = contactFileDocumentId(fileId);
  await db.runTransaction(async transaction => {
    const reference = transaction.collection(CONTACT_FILE_COLLECTION).doc(documentId);
    const previous = await readTransactionDocument(reference);
    if (previous && previous.ownerKey !== ownerKey) {
      throw publicError(403, "该二维码文件不属于当前用户，请重新选择并上传");
    }
    const now = Date.now();
    const alreadyShared = previous && previous.status === "shared";
    await reference.set({
      data: {
        ownerKey,
        fileId,
        profileOptionId: optionId,
        status: alreadyShared ? "shared" : "staged",
        stagedConversationId: alreadyShared ? "" : context.conversationId,
        stagedRequestId: alreadyShared ? "" : requestId,
        expiresAt: alreadyShared ? 0 : now + CONTACT_STAGE_TTL_MS,
        createdAt: Number(previous && previous.createdAt) || now,
        updatedAt: now
      }
    });
  }, 5);
  return { staged: true };
}

async function cancelStagedContactShare(ownerKey, conversationValue, requestValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const requestId = normalizeRequestId(requestValue);
  const records = await readDocuments(CONTACT_FILE_COLLECTION, { ownerKey }, 100);
  const staged = records.filter(record => (
    record.status === "staged" &&
    record.stagedConversationId === context.conversationId &&
    record.stagedRequestId === requestId
  ));
  await Promise.all(staged.map(record => cleanupContactQrIfUnused(ownerKey, record.fileId)));
  return { cancelled: true, removed: staged.length };
}

async function shareContact(ownerKey, conversationValue, contactItemValues, requestValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, context.conversationId);
  if (!request || request.status !== "accepted") {
    throw publicError(403, "需要双方先同意交换联系方式");
  }
  const requestId = normalizeRequestId(requestValue);
  const selected = normalizeContactOptions(contactItemValues);
  if (!selected.length) throw publicError(400, "请至少选择一条要分享的资料");
  await Promise.all(selected
    .filter(option => option.type === "qr")
    .map(option => claimContactQr(ownerKey, option.qrCodeFileId, option.id)));
  const items = selected.map(toStoredContactItem);
  const fingerprint = sha256(JSON.stringify(items));
  const documentId = contactDocumentId(context.conversationId, ownerKey);
  const commit = await db.runTransaction(async transaction => {
    const reference = transaction.collection(CONTACT_COLLECTION).doc(documentId);
    const previous = await readTransactionDocument(reference);
    if (previous && previous.lastShareRequestId === requestId) {
      if (previous.lastShareFingerprint !== fingerprint) {
        throw publicError(409, "同一次分享请求的内容发生变化，请重新选择后再试");
      }
      return { duplicate: true, previous };
    }
    const now = Date.now();
    await reference.set({
      data: {
        conversationId: context.conversationId,
        ownerKey,
        peerOwnerKey: context.peerOwnerKey,
        items,
        lastShareRequestId: requestId,
        lastShareFingerprint: fingerprint,
        createdAt: Number(previous && previous.createdAt) || now,
        updatedAt: now
      }
    });
    return { duplicate: false, previous };
  }, 5);
  await Promise.all(selected
    .filter(option => option.type === "qr")
    .map(option => finalizeContactQr(ownerKey, option.qrCodeFileId, option.id)));
  const previous = commit && commit.previous;
  const selectedQrIds = new Set(contactRecordQrIds({ items }));
  const removedQrIds = contactRecordQrIds(previous).filter(fileId => !selectedQrIds.has(fileId));
  await Promise.all(removedQrIds.map(fileId => cleanupContactQrIfUnused(ownerKey, fileId)));
  if (!commit || !commit.duplicate) {
    await updateMatchNotice(context.peerOwnerKey, ownerKey, "contact_updated");
  }
  return { contactExchange: await getContactExchangeState(
    ownerKey,
    context.peerOwnerKey,
    context.conversationId
  ) };
}

async function withdrawContact(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const documentId = contactDocumentId(context.conversationId, ownerKey);
  const previous = await readDocument(CONTACT_COLLECTION, documentId);
  await removeDocument(CONTACT_COLLECTION, documentId);
  await Promise.all(contactRecordQrIds(previous)
    .map(fileId => cleanupContactQrIfUnused(ownerKey, fileId)));
  await updateMatchNotice(context.peerOwnerKey, ownerKey, "contact_withdrawn");
  return { withdrawn: true, contactExchange: await getContactExchangeState(
    ownerKey,
    context.peerOwnerKey,
    context.conversationId
  ) };
}

async function assertAcceptedContactExchange(conversationId) {
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, conversationId);
  if (!request || request.status !== "accepted") {
    throw publicError(403, "需要双方先同意交换联系方式");
  }
}

async function getContactExchangeState(ownerKey, peerOwnerKey, conversationId) {
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, conversationId);
  if (!request || request.status === "cancelled") {
    return { status: "none", myContact: null, peerContact: null };
  }
  if (request.status === "pending") {
    return {
      status: request.requesterOwnerKey === ownerKey ? "pending_sent" : "pending_received",
      myContact: null,
      peerContact: null
    };
  }
  if (request.status !== "accepted") {
    return { status: "declined", myContact: null, peerContact: null };
  }
  const contacts = await Promise.all([
    readDocument(CONTACT_COLLECTION, contactDocumentId(conversationId, ownerKey)),
    readDocument(CONTACT_COLLECTION, contactDocumentId(conversationId, peerOwnerKey))
  ]);
  return {
    status: "accepted",
    myContact: contacts[0] ? toPublicContact(contacts[0]) : null,
    peerContact: contacts[1] ? toPublicContact(contacts[1]) : null
  };
}

async function clearConversationForMe(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const matchId = matchDocumentId(ownerKey, context.peerOwnerKey);
  const match = await readDocument(MATCH_COLLECTION, matchId);
  // 消息时间戳会在同一毫秒内单调递增，清空边界必须覆盖会话里最后一条消息。
  const now = Math.max(Date.now(), Number(context.conversation.lastMessageAt) || 0);
  await db.collection(MATCH_COLLECTION).doc(matchId).set({
    data: Object.assign({}, withoutDocumentId(match), {
      clearedBeforeAt: now,
      unreadCount: 0,
      newMatch: false,
      contactNotice: "",
      updatedAt: now
    })
  });
  return { cleared: true };
}

async function endRelationship(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  await terminateRelationship(ownerKey, context.peerOwnerKey, context.conversationId);
  return { ended: true };
}

async function blockUser(ownerKey, conversationValue) {
  const context = await getActiveConversationContext(ownerKey, conversationValue);
  const blockId = blockDocumentId(ownerKey, context.peerOwnerKey);
  const now = Date.now();
  await db.collection(BLOCK_COLLECTION).doc(blockId).set({
    data: {
      blockerOwnerKey: ownerKey,
      blockedOwnerKey: context.peerOwnerKey,
      conversationId: context.conversationId,
      createdAt: now,
      updatedAt: now
    }
  });
  await terminateRelationship(ownerKey, context.peerOwnerKey, context.conversationId);
  return { blocked: true, blockId };
}

async function terminateRelationship(ownerKey, peerOwnerKey, conversationId) {
  const conversation = await readDocument(CONVERSATION_COLLECTION, conversationId);
  const contacts = await Promise.all([
    readDocument(CONTACT_COLLECTION, contactDocumentId(conversationId, ownerKey)),
    readDocument(CONTACT_COLLECTION, contactDocumentId(conversationId, peerOwnerKey))
  ]);
  const now = Date.now();
  if (conversation) {
    await db.collection(CONVERSATION_COLLECTION).doc(conversationId).set({
      data: Object.assign({}, withoutDocumentId(conversation), {
        status: "ended",
        endedAt: now,
        endedByOwnerKey: ownerKey,
        updatedAt: now
      })
    });
  }
  const request = await readDocument(CONTACT_REQUEST_COLLECTION, conversationId);
  await Promise.all([
    removeDocument(MATCH_COLLECTION, matchDocumentId(ownerKey, peerOwnerKey)),
    removeDocument(MATCH_COLLECTION, matchDocumentId(peerOwnerKey, ownerKey)),
    removeDocument(CONTACT_COLLECTION, contactDocumentId(conversationId, ownerKey)),
    removeDocument(CONTACT_COLLECTION, contactDocumentId(conversationId, peerOwnerKey)),
    request
      ? db.collection(CONTACT_REQUEST_COLLECTION).doc(conversationId).set({
        data: Object.assign({}, withoutDocumentId(request), { status: "cancelled", updatedAt: now })
      })
      : Promise.resolve()
  ]);
  await Promise.all(contacts.flatMap(contact => contactRecordQrIds(contact)
    .map(fileId => cleanupContactQrIfUnused(contact.ownerKey, fileId))));
}

async function claimContactQr(ownerKey, fileId, profileOptionId) {
  const documentId = contactFileDocumentId(fileId);
  await db.runTransaction(async transaction => {
    const reference = transaction.collection(CONTACT_FILE_COLLECTION).doc(documentId);
    const previous = await readTransactionDocument(reference);
    if (previous && previous.ownerKey !== ownerKey) {
      throw publicError(403, "该二维码文件不属于当前用户，请重新选择并上传");
    }
    const now = Date.now();
    await reference.set({
      data: {
        ownerKey,
        fileId,
        profileOptionId: String(profileOptionId || previous && previous.profileOptionId || ""),
        status: previous && previous.status === "shared" ? "shared" : "staged",
        stagedConversationId: String(previous && previous.stagedConversationId || ""),
        stagedRequestId: String(previous && previous.stagedRequestId || ""),
        expiresAt: Number(previous && previous.expiresAt) || now + CONTACT_STAGE_TTL_MS,
        createdAt: Number(previous && previous.createdAt) || now,
        updatedAt: now
      }
    });
  }, 5);
}

async function finalizeContactQr(ownerKey, fileId, profileOptionId) {
  const documentId = contactFileDocumentId(fileId);
  const previous = await readDocument(CONTACT_FILE_COLLECTION, documentId);
  if (!previous || previous.ownerKey !== ownerKey || previous.fileId !== fileId) return;
  await db.collection(CONTACT_FILE_COLLECTION).doc(documentId).set({
    data: Object.assign({}, withoutDocumentId(previous), {
      profileOptionId: String(profileOptionId || previous.profileOptionId || ""),
      status: "shared",
      stagedConversationId: "",
      stagedRequestId: "",
      expiresAt: 0,
      updatedAt: Date.now()
    })
  });
}

async function cleanupExpiredStagedContactQrs(ownerKey) {
  const records = await readDocuments(CONTACT_FILE_COLLECTION, { ownerKey }, 100);
  const now = Date.now();
  const expired = records.filter(record => (
    record.status === "staged" && Number(record.expiresAt) > 0 && Number(record.expiresAt) <= now
  ));
  await Promise.all(expired.map(record => cleanupContactQrIfUnused(ownerKey, record.fileId)));
}

async function releaseProfileContactQr(ownerKey, fileId) {
  if (!isManagedContactQr(fileId)) return;
  const documentId = contactFileDocumentId(fileId);
  const previous = await readDocument(CONTACT_FILE_COLLECTION, documentId);
  if (previous && previous.ownerKey === ownerKey && previous.fileId === fileId) {
    await db.collection(CONTACT_FILE_COLLECTION).doc(documentId).set({
      data: Object.assign({}, withoutDocumentId(previous), {
        profileOptionId: "",
        updatedAt: Date.now()
      })
    });
  }
  await cleanupContactQrIfUnused(ownerKey, fileId);
}

async function cleanupContactQrIfUnused(ownerKey, fileId) {
  if (!ownerKey || !isManagedContactQr(fileId)) return;
  const profile = await readDocument(PROFILE_COLLECTION, ownerKey);
  if (profileContactQrIds(profile).includes(fileId)) return;
  const contacts = await readDocuments(CONTACT_COLLECTION, { ownerKey }, 100);
  if (contacts.some(contact => contactRecordQrIds(contact).includes(fileId))) return;
  await deleteOwnedContactQr(fileId, ownerKey, "未使用的联系方式二维码删除失败");
}

async function deleteOwnedContactQr(fileId, ownerKey, warningMessage) {
  if (!isManagedContactQr(fileId) || !ownerKey) return;
  const documentId = contactFileDocumentId(fileId);
  const record = await readDocument(CONTACT_FILE_COLLECTION, documentId);
  if (!record || record.ownerKey !== ownerKey || record.fileId !== fileId) return;
  try {
    await cloud.deleteFile({ fileList: [fileId] });
    await removeDocument(CONTACT_FILE_COLLECTION, documentId);
  } catch (error) {
    console.warn(warningMessage, error && (error.errMsg || error.message));
  }
}

async function getBlockedUsers(ownerKey) {
  const records = await readDocuments(BLOCK_COLLECTION, { blockerOwnerKey: ownerKey }, 100);
  const results = await Promise.all(records.map(async record => {
    const profile = await readDocument(PROFILE_COLLECTION, record.blockedOwnerKey);
    return {
      blockId: record._id || blockDocumentId(ownerKey, record.blockedOwnerKey),
      blockedAt: Number(record.createdAt) || 0,
      profile: profile ? toPublicProfile(profile) : null
    };
  }));
  return results.sort((a, b) => b.blockedAt - a.blockedAt);
}

async function unblockUser(ownerKey, blockValue) {
  const blockId = normalizeOpaqueId(blockValue, 64, "屏蔽记录编号无效");
  const record = await readDocument(BLOCK_COLLECTION, blockId);
  if (!record || record.blockerOwnerKey !== ownerKey) {
    throw publicError(404, "屏蔽记录不存在");
  }
  await removeDocument(BLOCK_COLLECTION, blockId);
  return { unblocked: true };
}

async function reportMessage(ownerKey, conversationValue, messageValue, reasonValue, noteValue) {
  const conversationId = normalizeOpaqueId(conversationValue, 64, "会话编号无效");
  const messageId = normalizeOpaqueId(messageValue, 64, "消息编号无效");
  const conversation = await readDocument(CONVERSATION_COLLECTION, conversationId);
  const peerOwnerKey = getConversationPeer(conversation, ownerKey);
  if (!peerOwnerKey) throw publicError(404, "无法确认被举报的会话");
  const message = await readDocument(MESSAGE_COLLECTION, messageId);
  if (
    !message ||
    message.conversationId !== conversationId ||
    message.senderOwnerKey !== peerOwnerKey ||
    message.recipientOwnerKey !== ownerKey
  ) {
    throw publicError(404, "只能举报对方发送给你的消息");
  }
  const reason = REPORT_REASONS.has(reasonValue) ? reasonValue : "other";
  const note = cleanText(noteValue, 120, "");
  const reportId = sha256(`social-report:${ownerKey}:${messageId}`);
  const previous = await readDocument(REPORT_COLLECTION, reportId);
  const now = Date.now();
  await db.collection(REPORT_COLLECTION).doc(reportId).set({
    data: {
      reporterOwnerKey: ownerKey,
      reportedOwnerKey: peerOwnerKey,
      conversationId,
      messageId,
      messageContentSnapshot: String(message.content || "").slice(0, 300),
      reason,
      note,
      status: "pending",
      createdAt: Number(previous && previous.createdAt) || now,
      updatedAt: now
    }
  });
  return { reported: true };
}

async function getActiveConversationContext(ownerKey, conversationValue) {
  const conversationId = normalizeOpaqueId(conversationValue, 64, "会话编号无效");
  const conversation = await readDocument(CONVERSATION_COLLECTION, conversationId);
  const peerOwnerKey = getConversationPeer(conversation, ownerKey);
  if (!peerOwnerKey) throw publicError(404, "这段伙伴会话不存在或无权操作");
  if (conversation.status === "ended") throw publicError(409, "伙伴关系已解除");
  if (await isBlockedBetween(ownerKey, peerOwnerKey)) throw publicError(403, "当前无法操作这段关系");
  const match = await readDocument(MATCH_COLLECTION, matchDocumentId(ownerKey, peerOwnerKey));
  if (!match) throw publicError(403, "只有已经互相确认的伙伴可以操作");
  return { conversationId, conversation, peerOwnerKey, match };
}

async function updateMatchNotice(ownerKey, peerOwnerKey, notice) {
  const documentId = matchDocumentId(ownerKey, peerOwnerKey);
  const match = await readDocument(MATCH_COLLECTION, documentId);
  if (!match) return;
  const now = Date.now();
  await db.collection(MATCH_COLLECTION).doc(documentId).set({
    data: Object.assign({}, withoutDocumentId(match), {
      contactNotice: normalizeContactNotice(notice),
      inboxSortKey: socialInboxSortKey(now, documentId),
      updatedAt: now
    })
  });
}

async function isBlockedBetween(firstOwnerKey, secondOwnerKey) {
  const records = await Promise.all([
    readDocument(BLOCK_COLLECTION, blockDocumentId(firstOwnerKey, secondOwnerKey)),
    readDocument(BLOCK_COLLECTION, blockDocumentId(secondOwnerKey, firstOwnerKey))
  ]);
  return Boolean(records[0] || records[1]);
}

async function deleteMyData(ownerKey) {
  const testPeerOwnerKey = soloTestPeerOwnerKey(ownerKey);
  const profile = await readDocument(PROFILE_COLLECTION, ownerKey);
  const ownedContacts = await readDocuments(CONTACT_COLLECTION, { ownerKey }, 100);
  const peerContacts = await readDocuments(CONTACT_COLLECTION, { peerOwnerKey: ownerKey }, 100);
  const contactFileRecords = await readDocuments(CONTACT_FILE_COLLECTION, { ownerKey }, 100);
  const contactQrRecords = ownedContacts.concat(peerContacts)
    .filter(record => isManagedContactQr(record.qrCodeFileId))
    .map(record => ({ fileId: record.qrCodeFileId, ownerKey: record.ownerKey }));
  contactFileRecords.forEach(record => {
    if (isManagedContactQr(record.fileId)) contactQrRecords.push({ fileId: record.fileId, ownerKey });
  });
  await Promise.all([
    removeDocument(PROFILE_COLLECTION, ownerKey),
    removeDocument(PROFILE_COLLECTION, testPeerOwnerKey),
    removeDocument(RESOLVE_USAGE_COLLECTION, ownerKey),
    removeDocument(RESOLVE_USAGE_COLLECTION, testPeerOwnerKey),
    removeWhere(TOKEN_COLLECTION, { ownerKey }),
    removeWhere(TOKEN_COLLECTION, { ownerKey: testPeerOwnerKey }),
    removeWhere(ENCOUNTER_REF_COLLECTION, { requesterOwnerKey: ownerKey }),
    removeWhere(ENCOUNTER_REF_COLLECTION, { targetOwnerKey: ownerKey }),
    removeWhere(GREETING_COLLECTION, { senderOwnerKey: ownerKey }),
    removeWhere(GREETING_COLLECTION, { recipientOwnerKey: ownerKey }),
    removeWhere(MATCH_COLLECTION, { ownerKey }),
    removeWhere(MATCH_COLLECTION, { peerOwnerKey: ownerKey }),
    removeWhere(CONVERSATION_COLLECTION, { memberAOwnerKey: ownerKey }),
    removeWhere(CONVERSATION_COLLECTION, { memberBOwnerKey: ownerKey }),
    removeWhere(MESSAGE_COLLECTION, { senderOwnerKey: ownerKey }),
    removeWhere(MESSAGE_COLLECTION, { recipientOwnerKey: ownerKey }),
    removeWhere(CONTACT_REQUEST_COLLECTION, { requesterOwnerKey: ownerKey }),
    removeWhere(CONTACT_REQUEST_COLLECTION, { recipientOwnerKey: ownerKey }),
    removeWhere(CONTACT_COLLECTION, { ownerKey }),
    removeWhere(CONTACT_COLLECTION, { peerOwnerKey: ownerKey }),
    removeWhere(BLOCK_COLLECTION, { blockerOwnerKey: ownerKey }),
    removeWhere(BLOCK_COLLECTION, { blockedOwnerKey: ownerKey }),
    removeWhere(REPORT_COLLECTION, { reporterOwnerKey: ownerKey }),
    removeWhere(REPORT_COLLECTION, { reportedOwnerKey: ownerKey })
  ]);
  const avatar = profile && profile.avatarType === "custom" ? profile.avatarValue : "";
  if (avatar && isManagedAvatar(avatar)) {
    try {
      await cloud.deleteFile({ fileList: [avatar] });
    } catch (error) {
      console.warn("删除社交头像失败：", error && (error.errMsg || error.message));
    }
  }
  await Promise.all(contactQrRecords.map(record => deleteOwnedContactQr(
    record.fileId,
    record.ownerKey,
    "删除联系方式二维码失败"
  )));
  await removeWhere(CONTACT_FILE_COLLECTION, { ownerKey });
  return { deleted: true };
}

async function registerTokenOwner(tokenId, ownerKey, now) {
  await db.runTransaction(async transaction => {
    const reference = transaction.collection(TOKEN_COLLECTION).doc(tokenId);
    let previous = null;
    try {
      const result = await reference.get();
      previous = result && result.data ? result.data : null;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    if (previous && previous.ownerKey && previous.ownerKey !== ownerKey && previous.expiresAt > now) {
      throw publicError(409, "该挂件匿名令牌已被占用，请重启挂件后重试");
    }
    await reference.set({
      data: { ownerKey, expiresAt: now + TOKEN_TTL_MS, updatedAt: now }
    });
  }, 5);
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
  const profile = {
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

async function assertResolveQuota(ownerKey) {
  const now = Date.now();
  const minuteBucket = Math.floor(now / 60000);
  await db.runTransaction(async transaction => {
    const reference = transaction.collection(RESOLVE_USAGE_COLLECTION).doc(ownerKey);
    const previous = await readTransactionDocument(reference);
    const count = previous && previous.minuteBucket === minuteBucket ? previous.count || 0 : 0;
    if (count >= RESOLVE_LIMIT_PER_MINUTE) {
      throw publicError(429, "附近名片查询过于频繁，请稍后再试");
    }
    await reference.set({
      data: Object.assign({}, withoutDocumentId(previous), {
        minuteBucket,
        count: count + 1,
        updatedAt: now
      })
    });
  }, 5);
}

async function readMessagePage(conversationId, clearedBeforeAt, beforeCreatedAt, pageSize) {
  const createdAtCondition = beforeCreatedAt
    ? command.and(command.gt(clearedBeforeAt), command.lt(beforeCreatedAt))
    : command.gt(clearedBeforeAt);
  const response = await db.collection(MESSAGE_COLLECTION)
    .where({ conversationId, createdAt: createdAtCondition })
    .orderBy("createdAt", "desc")
    .limit(pageSize + 1)
    .get();
  const records = response && Array.isArray(response.data) ? response.data : [];
  const visible = records.filter(record => (Number(record.createdAt) || 0) > clearedBeforeAt);
  const hasMore = visible.length > pageSize;
  const pageRecords = visible.slice(0, pageSize);
  const oldest = pageRecords[pageRecords.length - 1];
  return {
    records: pageRecords,
    hasMore,
    nextCursor: hasMore && oldest ? Number(oldest.createdAt) || null : null
  };
}

function normalizeMessagePageSize(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1) return MESSAGE_PAGE_SIZE;
  return Math.min(size, MESSAGE_PAGE_SIZE_MAX);
}

function normalizeMessageCursor(value) {
  if (value === undefined || value === null || value === "" || Number(value) === 0) return 0;
  const cursor = Number(value);
  if (!Number.isFinite(cursor) || cursor <= 0 || cursor > Date.now() + 60000) {
    throw publicError(400, "聊天记录分页位置无效");
  }
  return Math.floor(cursor);
}

async function readDocument(collectionName, id) {
  try {
    const result = await db.collection(collectionName).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function readTransactionDocument(reference) {
  try {
    const result = await reference.get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function readDocuments(collectionName, query, limit) {
  const response = await db.collection(collectionName).where(query).limit(limit || 30).get();
  return response && Array.isArray(response.data) ? response.data : [];
}

async function removeDocument(collectionName, id) {
  try {
    await db.collection(collectionName).doc(id).remove();
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

async function removeWhere(collectionName, query) {
  await db.collection(collectionName).where(query).remove();
}

function isNotFoundError(error) {
  const message = String(error && (error.errMsg || error.message) || "");
  return message.includes("does not exist") ||
    message.includes("NOT_FOUND") ||
    message.includes("DOCUMENT_NOT_EXIST") ||
    message.includes("-502005");
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

function isManagedContactQr(value) {
  return typeof value === "string" && value.startsWith("cloud://") && value.includes("/social-contact-qrs/");
}

function tokenDocumentId(appid, token) {
  return sha256(`${appid}:social-token:${token >>> 0}`);
}

function greetingDocumentId(senderOwnerKey, recipientOwnerKey) {
  return sha256(`greeting:${senderOwnerKey}:${recipientOwnerKey}`);
}

function matchDocumentId(ownerKey, peerOwnerKey) {
  return sha256(`match:${ownerKey}:${peerOwnerKey}`);
}

function conversationDocumentId(firstOwnerKey, secondOwnerKey) {
  const members = [firstOwnerKey, secondOwnerKey].sort();
  return sha256(`conversation:${members[0]}:${members[1]}`);
}

function soloTestPeerOwnerKey(ownerKey) {
  return sha256(`solo-test-peer:${ownerKey}`);
}

function contactDocumentId(conversationId, ownerKey) {
  return sha256(`contact:${conversationId}:${ownerKey}`);
}

function contactFileDocumentId(fileId) {
  return sha256(`contact-file:${fileId}`);
}

function blockDocumentId(blockerOwnerKey, blockedOwnerKey) {
  return sha256(`block:${blockerOwnerKey}:${blockedOwnerKey}`);
}

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
  if (containsRestrictedLink(text)) {
    throw publicError(400, "为保护双方安全，伙伴聊天暂不支持发送网址或外部链接");
  }
  if (containsDirectContactDetails(text)) {
    throw publicError(400, "请使用双方确认后的“交换联系方式”功能分享联系方式");
  }
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
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || usedIds.has(id)) {
      throw publicError(400, "私密分享资料编号无效，请删除后重新添加");
    }
    usedIds.add(id);
    const type = ["wechat", "phone", "qr"].includes(option.type) ? option.type : "";
    if (!type) throw publicError(400, "私密分享资料类型无效");
    const defaultLabel = type === "wechat" ? "微信号" : (type === "phone" ? "手机号" : "联系二维码");
    const label = cleanText(option.label, 12, "") || defaultLabel;
    if (type === "qr") {
      const qrCodeFileId = String(option.qrCodeFileId || "").trim();
      if (!isManagedContactQr(qrCodeFileId)) {
        throw publicError(400, `${label}的二维码尚未上传完成`);
      }
      return { id, type, label, qrCodeFileId };
    }
    const contactValue = String(option.value || "").trim().replace(/\s+/g, type === "phone" ? "" : " ");
    if (type === "wechat") {
      if (!/^[^\s]{5,32}$/.test(contactValue) || containsRestrictedLink(contactValue)) {
        throw publicError(400, `${label}格式不正确`);
      }
    } else {
      const phoneDigits = contactValue.replace(/\D/g, "");
      if (!/^\+?[0-9-]{6,20}$/.test(contactValue) || phoneDigits.length < 6 || phoneDigits.length > 15) {
        throw publicError(400, `${label}格式不正确`);
      }
    }
    return { id, type, label, value: contactValue };
  });
}

function toStoredContactItem(option) {
  return option.type === "qr"
    ? { id: option.id, type: option.type, label: option.label, qrCodeFileId: option.qrCodeFileId }
    : { id: option.id, type: option.type, label: option.label, value: option.value };
}

function toPublicContact(record) {
  let items;
  if (record && Array.isArray(record.items)) {
    items = normalizeContactOptions(record.items);
  } else {
    const legacy = [];
    if (record && record.wechatId) legacy.push({
      id: "legacy_wechat",
      type: "wechat",
      label: "微信号",
      value: record.wechatId
    });
    if (record && record.phone) legacy.push({
      id: "legacy_phone",
      type: "phone",
      label: "手机号",
      value: record.phone
    });
    if (record && isManagedContactQr(record.qrCodeFileId)) legacy.push({
      id: "legacy_qrcode",
      type: "qr",
      label: "联系二维码",
      qrCodeFileId: record.qrCodeFileId
    });
    items = normalizeContactOptions(legacy);
  }
  return { items, updatedAt: Number(record && record.updatedAt) || 0 };
}

function profileContactQrIds(record) {
  return (record && Array.isArray(record.contactOptions) ? record.contactOptions : [])
    .filter(option => option && option.type === "qr" && isManagedContactQr(option.qrCodeFileId))
    .map(option => option.qrCodeFileId);
}

function contactRecordQrIds(record) {
  if (!record) return [];
  if (Array.isArray(record.items)) {
    return record.items
      .filter(item => item && item.type === "qr" && isManagedContactQr(item.qrCodeFileId))
      .map(item => item.qrCodeFileId);
  }
  return isManagedContactQr(record.qrCodeFileId) ? [record.qrCodeFileId] : [];
}

function normalizeContactNotice(value) {
  const allowed = new Set(["requested", "accepted", "declined", "contact_updated", "contact_withdrawn"]);
  return allowed.has(value) ? value : "";
}

function beijingDayKey(timestamp) {
  const date = new Date((Number(timestamp) || Date.now()) + 8 * 60 * 60 * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) {
    throw publicError(400, "消息请求编号无效");
  }
  return requestId;
}

function toPublicMessage(record, ownerKey) {
  return {
    id: String(record._id || ""),
    sender: record.senderOwnerKey === ownerKey ? "me" : "peer",
    content: String(record.content || ""),
    createdAt: Number(record.createdAt) || 0
  };
}

function normalizeOpaqueId(value, length, message) {
  const id = String(value || "").trim().toLowerCase();
  const pattern = new RegExp(`^[a-f0-9]{${length}}$`);
  if (!pattern.test(id)) throw publicError(400, message);
  return id;
}

function withoutDocumentId(value) {
  const copy = Object.assign({}, value || {});
  delete copy._id;
  return copy;
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

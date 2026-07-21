const assert = require("assert");
const crypto = require("crypto");
const Module = require("module");

const collections = new Map();
let currentOpenid = "social-user-a";
const appid = "wx-social-test";
const deletedFiles = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCollection(name) {
  if (!collections.has(name)) collections.set(name, new Map());
  return collections.get(name);
}

function createDocument(collectionName, id) {
  return {
    async get() {
      const value = getCollection(collectionName).get(id);
      if (!value) throw new Error("DOCUMENT_NOT_EXIST");
      return { data: clone(value) };
    },
    async set(options) {
      getCollection(collectionName).set(id, Object.assign({ _id: id }, clone(options.data)));
      return {};
    },
    async remove() {
      getCollection(collectionName).delete(id);
      return {};
    }
  };
}

function createCollection(name) {
  return {
    doc(id) {
      return createDocument(name, id);
    },
    where(query) {
      const find = () => Array.from(getCollection(name).values())
        .filter(item => Object.keys(query).every(key => matchesCondition(item[key], query[key])));
      const orderings = [];
      const queryApi = {
        orderBy(field, direction) {
          orderings.push({ field, direction });
          return queryApi;
        },
        limit(limitValue) {
          return {
            async get() {
              const records = find().sort((first, second) => {
                for (const ordering of orderings) {
                  const difference = first[ordering.field] < second[ordering.field]
                    ? -1
                    : (first[ordering.field] > second[ordering.field] ? 1 : 0);
                  if (difference) return ordering.direction === "desc" ? -difference : difference;
                }
                return 0;
              });
              return { data: records.slice(0, limitValue).map(clone) };
            }
          };
        },
        async remove() {
          const matches = find();
          matches.forEach(item => getCollection(name).delete(item._id));
          return { stats: { removed: matches.length } };
        }
      };
      return queryApi;
    }
  };
}

function matchesCondition(value, condition) {
  if (!condition || typeof condition !== "object" || !condition.__command) {
    return value === condition;
  }
  if (condition.__command === "gt") return value > condition.value;
  if (condition.__command === "lt") return value < condition.value;
  if (condition.__command === "and") {
    return condition.conditions.every(item => matchesCondition(value, item));
  }
  return false;
}

const command = {
  gt(value) { return { __command: "gt", value }; },
  lt(value) { return { __command: "lt", value }; },
  and(...conditions) { return { __command: "and", conditions }; }
};

const database = {
  command,
  collection(name) {
    return createCollection(name);
  },
  async runTransaction(callback) {
    return callback({ collection: createCollection });
  }
};

const cloudStub = {
  DYNAMIC_CURRENT_ENV: "test",
  init() {},
  database() { return database; },
  getWXContext() { return { OPENID: currentOpenid, APPID: appid }; },
  async deleteFile(options) {
    deletedFiles.push(...options.fileList);
    return {};
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "wx-server-sdk") return cloudStub;
  return originalLoad.call(this, request, parent, isMain);
};

const socialFunction = require("../cloudfunctions/social/index");
Module._load = originalLoad;

function profile(nickname, overrides) {
  return Object.assign({
    avatarType: "virtual",
    avatarValue: "☁️",
    avatarColor: "#DFECE5",
    nickname,
    bio: `你好，我是${nickname}`,
    tags: ["摄影", "跑步"],
    intention: "chat",
    openid: "must-not-be-saved",
    phone: "13800000000",
    deviceId: "device-secret"
  }, overrides || {});
}

(async () => {
  const qrFileId = "cloud://test-env.7465-test/social-contact-qrs/user-a.jpg";
  const contactOptionsA = [
    { id: "contact_wechat_a", type: "wechat", label: "常用微信", value: "cloud_friend" },
    { id: "contact_qrcode_a", type: "qr", label: "微信二维码", qrCodeFileId: qrFileId }
  ];
  const contactOptionsB = [
    { id: "contact_phone_b", type: "phone", label: "常用手机", value: "138-0000-0000" }
  ];
  const empty = await socialFunction.main({ action: "getMyProfile" });
  assert.strictEqual(empty.code, 0);
  assert.strictEqual(empty.data.profile, null);

  const savedA = await socialFunction.main({
    action: "saveProfile",
    profile: profile("小云", { contactOptions: contactOptionsA })
  });
  assert.strictEqual(savedA.code, 0);
  assert.deepStrictEqual(Object.keys(savedA.data.profile).sort(), [
    "avatarColor", "avatarType", "avatarValue", "bio", "intention",
    "intentionLabel", "nickname", "tags"
  ].sort());
  assert.ok(!JSON.stringify(savedA).includes("must-not-be-saved"));
  assert.ok(!JSON.stringify(savedA).includes("13800000000"));
  assert.strictEqual(getCollection("social_profiles").values().next().value.contactOptions, undefined);
  assert.strictEqual(getCollection("social_contact_files").size, 0);
  const legacyOwnerKeyA = crypto.createHash("sha256").update("social-user-a").digest("hex");
  const legacyProfileA = Object.assign({}, getCollection("social_profiles").get(legacyOwnerKeyA), {
    contactOptions: contactOptionsA
  });
  getCollection("social_profiles").set(legacyOwnerKeyA, legacyProfileA);
  const legacyProfileView = await socialFunction.main({ action: "getMyProfile" });
  assert.strictEqual(legacyProfileView.data.profile.legacyContactOptions.length, 2);
  assert.strictEqual((await socialFunction.main({
    action: "saveProfile",
    profile: profile("小云")
  })).code, 0);
  assert.strictEqual(getCollection("social_profiles").get(legacyOwnerKeyA).contactOptions, undefined);
  const tokenA = 0x12345678;
  const registeredA = await socialFunction.main({ action: "registerToken", token: tokenA });
  assert.strictEqual(registeredA.code, 0);
  assert.ok(registeredA.data.expiresAt > Date.now() + 6 * 24 * 60 * 60 * 1000);

  currentOpenid = "social-user-b";
  const avatarFileId = "cloud://test-env.7465-test/social-avatars/user-b.jpg";
  const savedB = await socialFunction.main({
    action: "saveProfile",
    profile: profile("小团", {
      avatarType: "custom",
      avatarValue: avatarFileId,
      bio: "想认识一起打羽毛球的朋友",
      tags: ["羽毛球", "音乐"],
      intention: "buddy",
      contactOptions: contactOptionsB
    })
  });
  assert.strictEqual(savedB.code, 0);
  assert.strictEqual(savedB.data.profile.avatarValue, avatarFileId);
  assert.strictEqual(savedB.data.profile.intentionLabel, "找搭子");
  const tokenB = 0x23456789;
  assert.strictEqual((await socialFunction.main({ action: "registerToken", token: tokenB })).code, 0);

  currentOpenid = "social-user-a";
  const resolvedB = await socialFunction.main({ action: "resolveToken", token: tokenB });
  assert.strictEqual(resolvedB.code, 0);
  assert.strictEqual(resolvedB.data.profile.nickname, "小团");
  assert.strictEqual(resolvedB.data.profile.avatarValue, avatarFileId);
  assert.match(resolvedB.data.interactionRef, /^[a-f0-9]{48}$/);
  assert.ok(!JSON.stringify(resolvedB.data.profile).includes("138-0000-0000"));
  assert.ok(!("ownerKey" in resolvedB.data.profile));
  assert.ok(!("openid" in resolvedB.data.profile));

  const greetingToB = await socialFunction.main({
    action: "sendGreeting",
    interactionRef: resolvedB.data.interactionRef
  });
  assert.strictEqual(greetingToB.code, 0);
  assert.strictEqual(greetingToB.data.status, "sent");
  currentOpenid = "social-user-b";
  const inboxB = await socialFunction.main({ action: "getSocialInbox" });
  assert.strictEqual(inboxB.code, 0);
  assert.strictEqual(inboxB.data.greetings.length, 1);
  assert.strictEqual(inboxB.data.greetings[0].profile.nickname, "小云");
  assert.ok(!JSON.stringify(inboxB.data).includes("ownerKey"));

  const accepted = await socialFunction.main({
    action: "respondGreeting",
    greetingId: inboxB.data.greetings[0].greetingId,
    accept: true
  });
  assert.strictEqual(accepted.code, 0);
  assert.strictEqual(accepted.data.matched, true);
  assert.match(accepted.data.conversationId, /^[a-f0-9]{64}$/);
  const conversationId = accepted.data.conversationId;
  const acceptedAgain = await socialFunction.main({
    action: "respondGreeting",
    greetingId: inboxB.data.greetings[0].greetingId,
    accept: true
  });
  assert.strictEqual(acceptedAgain.code, 0);
  assert.strictEqual(acceptedAgain.data.matched, true, "重复确认应保持幂等匹配");

  const matchedInboxB = await socialFunction.main({ action: "getSocialInbox" });
  assert.strictEqual(matchedInboxB.data.greetings.length, 0);
  assert.strictEqual(matchedInboxB.data.matches.length, 1);
  assert.strictEqual(matchedInboxB.data.matches[0].profile.nickname, "小云");
  assert.strictEqual(matchedInboxB.data.matches[0].newMatch, false);
  assert.strictEqual(matchedInboxB.data.matches[0].conversationId, conversationId);

  currentOpenid = "social-user-a";
  const matchedInboxA = await socialFunction.main({ action: "getSocialInbox" });
  assert.strictEqual(matchedInboxA.data.matches.length, 1);
  assert.strictEqual(matchedInboxA.data.matches[0].profile.nickname, "小团");
  assert.strictEqual(matchedInboxA.data.matches[0].newMatch, true, "招呼发起方应看到对方已接受");
  assert.strictEqual(matchedInboxA.data.matches[0].conversationId, conversationId);

  const openedA = await socialFunction.main({ action: "getConversation", conversationId });
  assert.strictEqual(openedA.code, 0);
  assert.strictEqual(openedA.data.conversation.profile.nickname, "小团");
  assert.deepStrictEqual(openedA.data.messages, []);
  assert.ok(!JSON.stringify(openedA.data).includes("ownerKey"));
  const openedWithEmptyCursor = await socialFunction.main({
    action: "getConversation",
    conversationId,
    beforeCreatedAt: 0,
    pageSize: 30
  });
  assert.strictEqual(openedWithEmptyCursor.code, 0, "首屏游标 0 应视为未分页");
  assert.deepStrictEqual(openedWithEmptyCursor.data.messages, []);

  const requestIdA = "request_social_a_001";
  const sentA = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "你好，很高兴认识你 👋",
    requestId: requestIdA
  });
  assert.strictEqual(sentA.code, 0);
  assert.strictEqual(sentA.data.message.sender, "me");
  const retriedA = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "你好，很高兴认识你 👋",
    requestId: requestIdA
  });
  assert.strictEqual(retriedA.code, 0);
  assert.strictEqual(retriedA.data.message.id, sentA.data.message.id, "相同请求编号必须幂等");

  currentOpenid = "social-user-b";
  const unreadInboxB = await socialFunction.main({ action: "getSocialInbox" });
  assert.strictEqual(unreadInboxB.data.matches[0].unreadCount, 1, "网络重试不能重复累计未读");
  assert.strictEqual(unreadInboxB.data.matches[0].lastMessagePreview, "你好，很高兴认识你 👋");
  const openedB = await socialFunction.main({ action: "getConversation", conversationId });
  assert.strictEqual(openedB.code, 0);
  assert.strictEqual(openedB.data.messages.length, 1);
  assert.strictEqual(openedB.data.messages[0].sender, "peer");
  assert.strictEqual((await socialFunction.main({ action: "getSocialInbox" })).data.matches[0].unreadCount, 0);

  const sentB = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "我也很高兴认识你 😊",
    requestId: "request_social_b_001"
  });
  assert.strictEqual(sentB.code, 0);

  currentOpenid = "social-user-without-profile";
  const outsiderRead = await socialFunction.main({ action: "getConversation", conversationId });
  assert.strictEqual(outsiderRead.code, 404);
  const outsiderSend = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "不应发送成功",
    requestId: "request_outsider_001"
  });
  assert.strictEqual(outsiderSend.code, 404);

  currentOpenid = "social-user-a";
  const invalidMessage = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "   ",
    requestId: "request_invalid_001"
  });
  assert.strictEqual(invalidMessage.code, 400);
  const openedAgainA = await socialFunction.main({ action: "getConversation", conversationId });
  assert.strictEqual(openedAgainA.data.messages.length, 2);
  assert.strictEqual(openedAgainA.data.messages[1].sender, "peer");

  const paginationOwnerKeyA = crypto.createHash("sha256").update("social-user-a").digest("hex");
  const paginationOwnerKeyB = crypto.createHash("sha256").update("social-user-b").digest("hex");
  const paginationBaseTime = Date.now() + 1000;
  for (let index = 0; index < 65; index += 1) {
    const id = `pagination-message-${String(index).padStart(3, "0")}`;
    getCollection("social_messages").set(id, {
      _id: id,
      conversationId,
      senderOwnerKey: paginationOwnerKeyA,
      recipientOwnerKey: paginationOwnerKeyB,
      content: `分页消息 ${index}`,
      createdAt: paginationBaseTime + index
    });
  }
  const firstMessagePage = await socialFunction.main({
    action: "getConversation",
    conversationId,
    pageSize: 10
  });
  assert.strictEqual(firstMessagePage.code, 0);
  assert.strictEqual(firstMessagePage.data.messages.length, 10);
  assert.strictEqual(firstMessagePage.data.messages[0].content, "分页消息 55");
  assert.strictEqual(firstMessagePage.data.messages[9].content, "分页消息 64");
  assert.strictEqual(firstMessagePage.data.pagination.hasMore, true);
  const secondMessagePage = await socialFunction.main({
    action: "getConversation",
    conversationId,
    pageSize: 10,
    beforeCreatedAt: firstMessagePage.data.pagination.nextCursor
  });
  assert.strictEqual(secondMessagePage.data.messages[0].content, "分页消息 45");
  assert.strictEqual(secondMessagePage.data.messages[9].content, "分页消息 54");
  assert.strictEqual(
    new Set(firstMessagePage.data.messages.concat(secondMessagePage.data.messages)
      .map(message => message.id)).size,
    20,
    "相邻分页不能重复消息"
  );
  const firstIncrementalPage = await socialFunction.main({
    action: "getConversation",
    conversationId,
    pageSize: 3,
    afterCreatedAt: paginationBaseTime + 59
  });
  assert.strictEqual(firstIncrementalPage.code, 0);
  assert.strictEqual(firstIncrementalPage.data.pagination.direction, "after");
  assert.strictEqual(firstIncrementalPage.data.pagination.hasMore, true);
  assert.deepStrictEqual(
    firstIncrementalPage.data.messages.map(message => message.content),
    ["分页消息 60", "分页消息 61", "分页消息 62"]
  );
  const secondIncrementalPage = await socialFunction.main({
    action: "getConversation",
    conversationId,
    pageSize: 3,
    afterCreatedAt: firstIncrementalPage.data.pagination.nextCursor
  });
  assert.deepStrictEqual(
    secondIncrementalPage.data.messages.map(message => message.content),
    ["分页消息 63", "分页消息 64"]
  );
  const conflictingCursors = await socialFunction.main({
    action: "getConversation",
    conversationId,
    beforeCreatedAt: paginationBaseTime + 60,
    afterCreatedAt: paginationBaseTime + 50
  });
  assert.strictEqual(conflictingCursors.code, 400);
  for (let index = 0; index < 65; index += 1) {
    getCollection("social_messages").delete(
      `pagination-message-${String(index).padStart(3, "0")}`
    );
  }

  const requestedContact = await socialFunction.main({
    action: "requestContactExchange",
    conversationId
  });
  assert.strictEqual(requestedContact.code, 0);
  assert.strictEqual(requestedContact.data.contactExchange.status, "pending_sent");
  const prematureShare = await socialFunction.main({
    action: "shareContact",
    conversationId,
    contactItems: [contactOptionsA[0]]
  });
  assert.strictEqual(prematureShare.code, 403, "对方同意前不能分享联系方式");
  const cancelledContact = await socialFunction.main({
    action: "cancelContactExchange",
    conversationId
  });
  assert.strictEqual(cancelledContact.code, 0);
  assert.strictEqual(cancelledContact.data.contactExchange.status, "none");
  assert.strictEqual((await socialFunction.main({
    action: "requestContactExchange",
    conversationId
  })).code, 0, "撤回后可以重新申请");

  currentOpenid = "social-user-b";
  const contactInboxB = await socialFunction.main({ action: "getSocialInbox" });
  assert.strictEqual(contactInboxB.data.matches[0].contactNotice, "requested");
  const contactViewB = await socialFunction.main({ action: "getConversation", conversationId });
  assert.strictEqual(contactViewB.data.contactExchange.status, "pending_received");
  const acceptedContact = await socialFunction.main({
    action: "respondContactExchange",
    conversationId,
    accept: true
  });
  assert.strictEqual(acceptedContact.code, 0);
  assert.strictEqual(acceptedContact.data.contactExchange.status, "accepted");
  const sharedB = await socialFunction.main({
    action: "shareContact",
    conversationId,
    contactItems: [contactOptionsB[0]],
    requestId: "contact_share_user_b_001"
  });
  assert.strictEqual(sharedB.code, 0);
  assert.strictEqual(sharedB.data.contactExchange.myContact.items[0].value, "138-0000-0000");

  currentOpenid = "social-user-a";
  const acceptedViewA = await socialFunction.main({ action: "getConversation", conversationId });
  assert.strictEqual(acceptedViewA.data.contactExchange.peerContact.items[0].value, "138-0000-0000");
  assert.strictEqual(acceptedViewA.data.contactExchange.shareOptions, undefined);
  assert.ok(!JSON.stringify(acceptedViewA.data.contactExchange).includes("ownerKey"));
  const stagedQr = await socialFunction.main({
    action: "stageContactQr",
    conversationId,
    optionId: contactOptionsA[1].id,
    fileId: qrFileId,
    requestId: "contact_share_user_a_001"
  });
  assert.strictEqual(stagedQr.code, 0);
  const sharedA = await socialFunction.main({
    action: "shareContact",
    conversationId,
    contactItems: contactOptionsA,
    requestId: "contact_share_user_a_001"
  });
  assert.strictEqual(sharedA.code, 0);
  assert.strictEqual(sharedA.data.contactExchange.myContact.items.length, 2);
  const contactRecordA = Array.from(getCollection("social_contacts").values())
    .find(record => record.ownerKey === legacyOwnerKeyA);
  const sharedAt = contactRecordA.updatedAt;
  const duplicateShareA = await socialFunction.main({
    action: "shareContact",
    conversationId,
    contactItems: contactOptionsA,
    requestId: "contact_share_user_a_001"
  });
  assert.strictEqual(duplicateShareA.code, 0);
  assert.strictEqual(
    Array.from(getCollection("social_contacts").values())
      .find(record => record.ownerKey === legacyOwnerKeyA).updatedAt,
    sharedAt,
    "同一分享请求重试不应重复写入"
  );
  const conflictingShareA = await socialFunction.main({
    action: "shareContact",
    conversationId,
    contactItems: [contactOptionsA[0]],
    requestId: "contact_share_user_a_001"
  });
  assert.strictEqual(conflictingShareA.code, 409);
  currentOpenid = "social-user-b";
  const stolenQrRejected = await socialFunction.main({
    action: "shareContact",
    conversationId,
    contactItems: [contactOptionsA[1]],
    requestId: "contact_share_stolen_001"
  });
  assert.strictEqual(stolenQrRejected.code, 403, "不能冒用已经属于对方的二维码文件");
  currentOpenid = "social-user-a";
  const expiredQrFileId = "cloud://test-env.7465-test/social-contact-qrs/expired-user-a.jpg";
  const expiredQrRecordId = crypto.createHash("sha256")
    .update(`contact-file:${expiredQrFileId}`)
    .digest("hex");
  getCollection("social_contact_files").set(expiredQrRecordId, {
    _id: expiredQrRecordId,
    ownerKey: legacyOwnerKeyA,
    fileId: expiredQrFileId,
    status: "staged",
    expiresAt: Date.now() - 1
  });
  assert.strictEqual((await socialFunction.main({
    action: "getContactExchange",
    conversationId
  })).code, 0);
  assert.ok(deletedFiles.includes(expiredQrFileId), "过期的临时二维码应在读取交换状态时清理");
  const withdrawnA = await socialFunction.main({ action: "withdrawContact", conversationId });
  assert.strictEqual(withdrawnA.code, 0);
  assert.strictEqual(withdrawnA.data.contactExchange.myContact, null);
  assert.ok(deletedFiles.includes(qrFileId), "撤回后应删除不再使用的已分享二维码副本");
  assert.strictEqual(getCollection("social_contact_files").size, 0);

  const reported = await socialFunction.main({
    action: "reportMessage",
    conversationId,
    messageId: sentB.data.message.id,
    reason: "harassment",
    note: "测试举报"
  });
  assert.strictEqual(reported.code, 0);
  assert.strictEqual(getCollection("social_reports").size, 1);
  assert.strictEqual(Array.from(getCollection("social_reports").values())[0].reason, "harassment");

  const linkRejected = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "请打开 https://example.com",
    requestId: "request_link_test_001"
  });
  assert.strictEqual(linkRejected.code, 400);
  const contactBypassRejected = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "手机号 13800000000",
    requestId: "request_phone_test_001"
  });
  assert.strictEqual(contactBypassRejected.code, 400);

  for (let index = 0; index < 11; index += 1) {
    const rateMessage = await socialFunction.main({
      action: "sendSocialMessage",
      conversationId,
      content: `频率测试消息 ${index + 1}`,
      requestId: `request_rate_test_${String(index).padStart(3, "0")}`
    });
    assert.strictEqual(rateMessage.code, 0);
  }
  const rateLimited = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "这一条应该被频控",
    requestId: "request_rate_test_limit"
  });
  assert.strictEqual(rateLimited.code, 429);

  const clearedA = await socialFunction.main({ action: "clearConversationForMe", conversationId });
  assert.strictEqual(clearedA.code, 0);
  assert.strictEqual((await socialFunction.main({ action: "getConversation", conversationId })).data.messages.length, 0);
  const endedA = await socialFunction.main({ action: "endRelationship", conversationId });
  assert.strictEqual(endedA.code, 0);
  const sendAfterEnd = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId,
    content: "解除后不能发送",
    requestId: "request_after_end_001"
  });
  assert.strictEqual(sendAfterEnd.code, 409);

  const greetingAgain = await socialFunction.main({
    action: "sendGreeting",
    interactionRef: resolvedB.data.interactionRef
  });
  assert.strictEqual(greetingAgain.code, 0);
  assert.strictEqual(greetingAgain.data.status, "sent", "解除关系后必须重新获得对方同意");
  currentOpenid = "social-user-b";
  const inboxAgainB = await socialFunction.main({ action: "getSocialInbox" });
  assert.strictEqual(inboxAgainB.data.matches.length, 0);
  assert.strictEqual(inboxAgainB.data.greetings.length, 1);
  const acceptedAgainB = await socialFunction.main({
    action: "respondGreeting",
    greetingId: inboxAgainB.data.greetings[0].greetingId,
    accept: true
  });
  assert.strictEqual(acceptedAgainB.code, 0);

  currentOpenid = "social-user-a";
  const blockedA = await socialFunction.main({ action: "blockUser", conversationId });
  assert.strictEqual(blockedA.code, 0);
  assert.match(blockedA.data.blockId, /^[a-f0-9]{64}$/);
  const blockListA = await socialFunction.main({ action: "getBlockedUsers" });
  assert.strictEqual(blockListA.data.blockedUsers.length, 1);
  assert.strictEqual(blockListA.data.blockedUsers[0].profile.nickname, "小团");

  currentOpenid = "social-user-b";
  const blockedResolve = await socialFunction.main({ action: "resolveToken", token: tokenA });
  assert.strictEqual(blockedResolve.code, 0);
  assert.strictEqual(blockedResolve.data.profile, null);
  assert.strictEqual(blockedResolve.data.reason, "not_found");

  currentOpenid = "social-user-a";
  const unblockedA = await socialFunction.main({
    action: "unblockUser",
    blockId: blockedA.data.blockId
  });
  assert.strictEqual(unblockedA.code, 0);
  assert.strictEqual((await socialFunction.main({ action: "getBlockedUsers" })).data.blockedUsers.length, 0);

  const self = await socialFunction.main({ action: "resolveToken", token: tokenA });
  assert.strictEqual(self.code, 0);
  assert.strictEqual(self.data.profile, null);
  assert.strictEqual(self.data.reason, "self");

  currentOpenid = "social-user-b";
  const hijack = await socialFunction.main({ action: "registerToken", token: tokenA });
  assert.strictEqual(hijack.code, 409);

  currentOpenid = "social-user-without-profile";
  const noOwnProfile = await socialFunction.main({ action: "resolveToken", token: tokenA });
  assert.strictEqual(noOwnProfile.code, 409);

  const ownerKeyA = crypto.createHash("sha256").update("social-user-a").digest("hex");
  const profileRecordA = getCollection("social_profiles").get(ownerKeyA);
  assert.ok(profileRecordA);
  assert.strictEqual(profileRecordA.ownerKey, ownerKeyA);
  assert.ok(!("openid" in profileRecordA));
  assert.ok(!("phone" in profileRecordA));
  assert.ok(!("deviceId" in profileRecordA));

  const rawTokenDocumentId = String(tokenA);
  assert.strictEqual(getCollection("social_tokens").has(rawTokenDocumentId), false);
  assert.ok(Array.from(getCollection("social_tokens").keys()).every(id => /^[a-f0-9]{64}$/.test(id)));

  currentOpenid = "social-user-b";
  const deleted = await socialFunction.main({ action: "deleteMyData" });
  assert.strictEqual(deleted.code, 0);
  const ownerKeyB = crypto.createHash("sha256").update("social-user-b").digest("hex");
  assert.strictEqual(getCollection("social_profiles").has(ownerKeyB), false);
  assert.ok(deletedFiles.includes(avatarFileId));
  assert.ok(Array.from(getCollection("social_matches").values())
    .every(item => item.ownerKey !== ownerKeyB && item.peerOwnerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_conversations").values())
    .every(item => item.memberAOwnerKey !== ownerKeyB && item.memberBOwnerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_messages").values())
    .every(item => item.senderOwnerKey !== ownerKeyB && item.recipientOwnerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_contact_requests").values())
    .every(item => item.requesterOwnerKey !== ownerKeyB && item.recipientOwnerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_contacts").values())
    .every(item => item.ownerKey !== ownerKeyB && item.peerOwnerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_contact_files").values())
    .every(item => item.ownerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_blocks").values())
    .every(item => item.blockerOwnerKey !== ownerKeyB && item.blockedOwnerKey !== ownerKeyB));
  assert.ok(Array.from(getCollection("social_reports").values())
    .every(item => item.reporterOwnerKey !== ownerKeyB && item.reportedOwnerKey !== ownerKeyB));

  currentOpenid = "social-solo-user";
  assert.strictEqual((await socialFunction.main({
    action: "saveProfile",
    profile: profile("单人测试者")
  })).code, 0);
  const soloPrepared = await socialFunction.main({ action: "prepareSoloTestPartner" });
  assert.strictEqual(soloPrepared.code, 0);
  assert.ok(Number.isInteger(soloPrepared.data.token) && soloPrepared.data.token > 0);
  assert.strictEqual(soloPrepared.data.profile.nickname, "云团测试伙伴");
  assert.strictEqual(soloPrepared.data.profile.isSoloTest, true);

  const soloResolved = await socialFunction.main({
    action: "resolveToken",
    token: soloPrepared.data.token
  });
  assert.strictEqual(soloResolved.code, 0);
  assert.strictEqual(soloResolved.data.profile.isSoloTest, true);
  currentOpenid = "social-user-a";
  const isolatedSoloPartner = await socialFunction.main({
    action: "resolveToken",
    token: soloPrepared.data.token
  });
  assert.strictEqual(isolatedSoloPartner.code, 0);
  assert.strictEqual(isolatedSoloPartner.data.profile, null);
  assert.strictEqual(isolatedSoloPartner.data.reason, "not_found");
  currentOpenid = "social-solo-user";
  const soloGreeting = await socialFunction.main({
    action: "sendGreeting",
    interactionRef: soloResolved.data.interactionRef
  });
  assert.strictEqual(soloGreeting.code, 0);
  assert.strictEqual(soloGreeting.data.matched, true);
  assert.strictEqual(soloGreeting.data.soloTestAutoAccepted, true);
  const soloConversationId = soloGreeting.data.conversationId;

  const soloMessage = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId: soloConversationId,
    content: "单人聊天测试",
    requestId: "request_solo_user_001"
  });
  assert.strictEqual(soloMessage.code, 0);
  for (let index = 2; index <= 3; index += 1) {
    const additionalMessage = await socialFunction.main({
      action: "sendSocialMessage",
      conversationId: soloConversationId,
      content: `等待回复前的第 ${index} 条消息`,
      requestId: `request_solo_user_00${index}`
    });
    assert.strictEqual(additionalMessage.code, 0);
  }
  const soloBeforeReply = await socialFunction.main({
    action: "getConversation",
    conversationId: soloConversationId
  });
  assert.strictEqual(soloBeforeReply.data.messagePolicy.limited, true);
  assert.strictEqual(soloBeforeReply.data.messagePolicy.remainingBeforeReply, 0);
  const fourthMessageBeforeReply = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId: soloConversationId,
    content: "等待回复前的第 4 条消息",
    requestId: "request_solo_user_004"
  });
  assert.strictEqual(fourthMessageBeforeReply.code, 429);
  assert.match(fourthMessageBeforeReply.message, /最多发送 3 条/);
  const soloReply = await socialFunction.main({
    action: "soloTestPeerAction",
    conversationId: soloConversationId,
    testAction: "message"
  });
  assert.strictEqual(soloReply.code, 0);
  assert.strictEqual(soloReply.data.message.sender, "peer");
  const soloAfterReplyMessage = await socialFunction.main({
    action: "sendSocialMessage",
    conversationId: soloConversationId,
    content: "对方回复后可以继续发送",
    requestId: "request_solo_user_005"
  });
  assert.strictEqual(soloAfterReplyMessage.code, 0);
  const soloConversation = await socialFunction.main({
    action: "getConversation",
    conversationId: soloConversationId
  });
  assert.strictEqual(soloConversation.data.messages.length, 5);
  assert.strictEqual(soloConversation.data.messagePolicy.limited, false);
  assert.strictEqual(soloConversation.data.messagePolicy.peerHasReplied, true);
  assert.strictEqual(soloConversation.data.conversation.profile.isSoloTest, true);

  const soloContactRequest = await socialFunction.main({
    action: "soloTestPeerAction",
    conversationId: soloConversationId,
    testAction: "request_contact"
  });
  assert.strictEqual(soloContactRequest.code, 0);
  assert.strictEqual((await socialFunction.main({
    action: "getConversation",
    conversationId: soloConversationId
  })).data.contactExchange.status, "pending_received");
  assert.strictEqual((await socialFunction.main({
    action: "respondContactExchange",
    conversationId: soloConversationId,
    accept: true
  })).code, 0);
  assert.strictEqual((await socialFunction.main({
    action: "soloTestPeerAction",
    conversationId: soloConversationId,
    testAction: "share_contact"
  })).code, 0);
  assert.strictEqual((await socialFunction.main({
    action: "getConversation",
    conversationId: soloConversationId
  })).data.contactExchange.peerContact.items[0].value, "YunTuan-Test");

  const soloOwnerKey = crypto.createHash("sha256").update(currentOpenid).digest("hex");
  const soloPeerOwnerKey = crypto.createHash("sha256")
    .update(`solo-test-peer:${soloOwnerKey}`)
    .digest("hex");
  assert.ok(getCollection("social_profiles").has(soloPeerOwnerKey));
  assert.strictEqual((await socialFunction.main({ action: "deleteMyData" })).code, 0);
  assert.strictEqual(getCollection("social_profiles").has(soloPeerOwnerKey), false);
  assert.ok(Array.from(getCollection("social_tokens").values())
    .every(item => item.ownerKey !== soloPeerOwnerKey));

  currentOpenid = "pagination-user";
  assert.strictEqual((await socialFunction.main({
    action: "saveProfile",
    profile: profile("分页测试用户")
  })).code, 0);
  const paginationOwnerKey = crypto.createHash("sha256").update(currentOpenid).digest("hex");
  const paginationNow = Date.now();
  for (let index = 0; index < 25; index += 1) {
    const peerOwnerKey = crypto.createHash("sha256").update(`pagination-peer-${index}`).digest("hex");
    const matchId = crypto.createHash("sha256")
      .update(`match:${paginationOwnerKey}:${peerOwnerKey}`)
      .digest("hex");
    const greetingId = crypto.createHash("sha256")
      .update(`greeting:${peerOwnerKey}:${paginationOwnerKey}`)
      .digest("hex");
    const matchAt = paginationNow - index * 1000;
    const greetingAt = paginationNow - index * 1000 - 500;
    getCollection("social_profiles").set(peerOwnerKey, {
      _id: peerOwnerKey,
      ownerKey: peerOwnerKey,
      avatarType: "virtual",
      avatarValue: "友",
      avatarColor: "#DFECE5",
      nickname: `分页伙伴${index}`,
      bio: "分页测试",
      tags: [],
      intention: "chat"
    });
    getCollection("social_matches").set(matchId, {
      _id: matchId,
      ownerKey: paginationOwnerKey,
      peerOwnerKey,
      conversationId: crypto.createHash("sha256").update(`page-conversation-${index}`).digest("hex"),
      matchedAt: matchAt,
      lastMessageAt: matchAt,
      inboxSortKey: `${String(matchAt).padStart(13, "0")}:${matchId}`
    });
    getCollection("social_greetings").set(greetingId, {
      _id: greetingId,
      senderOwnerKey: peerOwnerKey,
      recipientOwnerKey: paginationOwnerKey,
      status: "pending",
      createdAt: greetingAt,
      inboxSortKey: `${String(greetingAt).padStart(13, "0")}:${greetingId}`
    });
  }
  const pagedFriendIds = [];
  let friendCursor = "";
  do {
    const page = await socialFunction.main({
      action: "getSocialInbox",
      section: "friends",
      cursor: friendCursor,
      pageSize: 10
    });
    assert.strictEqual(page.code, 0);
    pagedFriendIds.push(...page.data.matches.map(item => item.matchId));
    friendCursor = page.data.pagination.friends.nextCursor;
  } while (friendCursor);
  assert.strictEqual(pagedFriendIds.length, 25);
  assert.strictEqual(new Set(pagedFriendIds).size, 25, "朋友分页不应重复");

  const pagedGreetingIds = [];
  let greetingCursor = "";
  do {
    const page = await socialFunction.main({
      action: "getSocialInbox",
      section: "greetings",
      cursor: greetingCursor,
      pageSize: 9
    });
    assert.strictEqual(page.code, 0);
    pagedGreetingIds.push(...page.data.greetings.map(item => item.greetingId));
    greetingCursor = page.data.pagination.greetings.nextCursor;
  } while (greetingCursor);
  assert.strictEqual(pagedGreetingIds.length, 25);
  assert.strictEqual(new Set(pagedGreetingIds).size, 25, "招呼分页不应重复");

  console.log("social cloud function tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

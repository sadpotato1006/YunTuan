async function routeSocialAction(action, ownerKey, event, handlers) {
  const h = handlers;
  if (action === "sendGreeting") {
    return handled(await h.sendGreetingWithSoloTest(ownerKey, event.interactionRef));
  }
  if (action === "getSocialInbox") {
    return handled(await h.getSocialInbox(ownerKey, event));
  }
  if (action === "respondGreeting") {
    return handled(await h.respondGreeting(ownerKey, event.greetingId, event.accept));
  }
  if (action === "getConversation") {
    return handled(await h.getConversation(
      ownerKey,
      event.conversationId,
      event.beforeCreatedAt,
      event.pageSize,
      event.afterCreatedAt
    ));
  }
  if (action === "sendSocialMessage") {
    return handled(await h.sendSocialMessage(
      ownerKey,
      event.conversationId,
      event.content,
      event.requestId
    ));
  }
  if (action === "soloTestPeerAction") {
    return handled(await h.runSoloTestPeerAction(
      ownerKey,
      event.conversationId,
      event.testAction
    ));
  }
  if (action === "requestContactExchange") {
    return handled(await h.requestContactExchange(ownerKey, event.conversationId));
  }
  if (action === "respondContactExchange") {
    return handled(await h.respondContactExchange(ownerKey, event.conversationId, event.accept));
  }
  if (action === "cancelContactExchange") {
    return handled(await h.cancelContactExchange(ownerKey, event.conversationId));
  }
  if (action === "getContactExchange") {
    return handled(await h.getContactExchange(ownerKey, event.conversationId));
  }
  if (action === "stageContactQr") {
    return handled(await h.stageContactQr(
      ownerKey,
      event.conversationId,
      event.optionId,
      event.fileId,
      event.requestId
    ));
  }
  if (action === "cancelStagedContactShare") {
    return handled(await h.cancelStagedContactShare(
      ownerKey,
      event.conversationId,
      event.requestId
    ));
  }
  if (action === "shareContact") {
    return handled(await h.shareContact(
      ownerKey,
      event.conversationId,
      event.contactItems,
      event.requestId
    ));
  }
  if (action === "withdrawContact") {
    return handled(await h.withdrawContact(ownerKey, event.conversationId));
  }
  if (action === "clearConversationForMe") {
    return handled(await h.clearConversationForMe(ownerKey, event.conversationId));
  }
  if (action === "endRelationship") {
    return handled(await h.endRelationship(ownerKey, event.conversationId));
  }
  if (action === "blockUser") {
    return handled(await h.blockUser(ownerKey, event.conversationId));
  }
  if (action === "getBlockedUsers") {
    return handled({ blockedUsers: await h.getBlockedUsers(ownerKey) });
  }
  if (action === "unblockUser") {
    return handled(await h.unblockUser(ownerKey, event.blockId));
  }
  if (action === "reportMessage") {
    return handled(await h.reportMessage(
      ownerKey,
      event.conversationId,
      event.messageId,
      event.reason,
      event.note
    ));
  }
  if (action === "deleteMyData") {
    return handled(await h.deleteMyData(ownerKey));
  }
  return { handled: false, data: null };
}

function handled(data) {
  return { handled: true, data };
}

module.exports = { routeSocialAction };

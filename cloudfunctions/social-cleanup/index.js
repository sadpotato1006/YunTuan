const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const command = db.command;

const TOKEN_COLLECTION = "social_tokens";
const RESOLVE_USAGE_COLLECTION = "social_resolve_usage";
const ENCOUNTER_REF_COLLECTION = "social_encounter_refs";
const CONVERSATION_COLLECTION = "social_conversations";
const MESSAGE_COLLECTION = "social_messages";
const CONTACT_REQUEST_COLLECTION = "social_contact_requests";
const CONTACT_COLLECTION = "social_contacts";
const CONTACT_FILE_COLLECTION = "social_contact_files";

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_COLLECTION = 30;
const STALE_USAGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENDED_CONVERSATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

exports.main = async () => {
  const now = Date.now();
  const summary = {};
  summary.expiredTokens = await removeExpired(TOKEN_COLLECTION, now);
  summary.expiredEncounterRefs = await removeExpired(ENCOUNTER_REF_COLLECTION, now);
  summary.staleResolveUsage = await removeByTimestamp(
    RESOLVE_USAGE_COLLECTION,
    "updatedAt",
    now - STALE_USAGE_MS
  );
  summary.expiredContactFiles = await cleanupStagedContactFiles(now);
  summary.endedConversations = await cleanupEndedConversations(
    now - ENDED_CONVERSATION_RETENTION_MS
  );
  console.info("social lifecycle cleanup complete", summary);
  return { code: 0, message: "ok", data: summary };
};

async function removeExpired(collectionName, now) {
  return drainQuery(collectionName, {
    expiresAt: command.and(command.gt(0), command.lte(now))
  });
}

async function removeByTimestamp(collectionName, field, before) {
  return drainQuery(collectionName, { [field]: command.lte(before) });
}

async function cleanupStagedContactFiles(now) {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_COLLECTION; batch += 1) {
    const records = await readBatch(CONTACT_FILE_COLLECTION, {
      expiresAt: command.and(command.gt(0), command.lte(now))
    });
    if (!records.length) break;
    let progressed = false;
    for (const record of records) {
      if (record.status !== "staged" || !isManagedContactQr(record.fileId)) {
        await removeDocument(CONTACT_FILE_COLLECTION, record._id);
        removed += 1;
        progressed = true;
        continue;
      }
      try {
        await cloud.deleteFile({ fileList: [record.fileId] });
        await removeDocument(CONTACT_FILE_COLLECTION, record._id);
        removed += 1;
        progressed = true;
      } catch (error) {
        console.warn("expired contact QR cleanup failed", {
          id: record._id,
          message: error && (error.errMsg || error.message)
        });
      }
    }
    if (!progressed || records.length < BATCH_SIZE) break;
  }
  return removed;
}

async function cleanupEndedConversations(before) {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_COLLECTION; batch += 1) {
    const candidates = await readBatch(CONVERSATION_COLLECTION, {
      status: "ended",
      updatedAt: command.lte(before)
    });
    if (!candidates.length) break;
    for (const conversation of candidates) {
      const conversationId = conversation._id;
      await Promise.all([
        drainQuery(MESSAGE_COLLECTION, { conversationId }),
        drainQuery(CONTACT_COLLECTION, { conversationId }),
        removeDocument(CONTACT_REQUEST_COLLECTION, conversationId)
      ]);
      await removeDocument(CONVERSATION_COLLECTION, conversationId);
      removed += 1;
    }
    if (candidates.length < BATCH_SIZE) break;
  }
  return removed;
}

async function drainQuery(collectionName, query) {
  let removed = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_COLLECTION; batch += 1) {
    const records = await readBatch(collectionName, query);
    if (!records.length) break;
    await Promise.all(records.map(record => removeDocument(collectionName, record._id)));
    removed += records.length;
    if (records.length < BATCH_SIZE) break;
  }
  return removed;
}

async function readBatch(collectionName, query) {
  const result = await db.collection(collectionName).where(query).limit(BATCH_SIZE).get();
  return result && Array.isArray(result.data) ? result.data : [];
}

async function removeDocument(collectionName, id) {
  if (!id) return;
  try {
    await db.collection(collectionName).doc(id).remove();
  } catch (error) {
    const message = String(error && (error.errMsg || error.message) || "");
    if (!message.includes("NOT_FOUND") && !message.includes("DOCUMENT_NOT_EXIST") && !message.includes("-502005")) {
      throw error;
    }
  }
}

function isManagedContactQr(value) {
  return typeof value === "string" && /^cloud:\/\/[^/]+\/social-contact-qrs\//.test(value);
}

module.exports._test = {
  removeExpired,
  cleanupStagedContactFiles,
  cleanupEndedConversations
};

const crypto = require("crypto");
const { PublicError, getShanghaiDayKey } = require("./chat-guard");

const MAX_RECENT_REQUESTS = 20;
const PENDING_TIMEOUT_MS = 90 * 1000;

function createChatIdempotency(db, collectionName) {
  const collection = collectionName || "chat_usage";

  async function claim(openid, requestId, policy) {
    const normalizedRequestId = normalizeRequestId(requestId);
    const now = Date.now();
    const dayKey = getShanghaiDayKey(now);
    const userKey = sha256(openid);
    const requestKey = sha256(normalizedRequestId).slice(0, 32);

    await ensureUsageDocument(db, collection, userKey, now, dayKey);
    let outcome = null;
    try {
      await db.runTransaction(async transaction => {
        const document = transaction.collection(collection).doc(userKey);
        const snapshot = await document.get();
        const state = snapshot && snapshot.data ? snapshot.data : {};
        const recentRequests = Array.isArray(state.recentRequests)
          ? state.recentRequests.filter(item => item && item.key)
          : [];
        const existingIndex = recentRequests.findIndex(item => item.key === requestKey);
        const existing = existingIndex >= 0 ? recentRequests[existingIndex] : null;

        if (existing && existing.status === "completed" && existing.reply) {
          outcome = {
            owner: false,
            cached: true,
            requestKey,
            data: { reply: existing.reply }
          };
          return;
        }
        if (existing && existing.status === "pending" &&
            now - (Number(existing.updatedAt) || now) < PENDING_TIMEOUT_MS) {
          throw new Error("CHAT_REQUEST_PENDING");
        }

        let windowStartedAt = Number(state.windowStartedAt) || now;
        let windowCount = Number(state.windowCount) || 0;
        const dailyUsage = state.dayKey === dayKey && state.dailyUsage &&
          typeof state.dailyUsage === "object"
          ? Object.assign({}, state.dailyUsage)
          : {};

        if (now < windowStartedAt || now - windowStartedAt >= policy.rateWindowMilliseconds) {
          windowStartedAt = now;
          windowCount = 0;
        }
        if (windowCount >= policy.rateMaximum) throw new Error("CHAT_RATE_LIMIT");
        const attempts = existing ? (Number(existing.attempts) || 1) + 1 : 1;
        if (attempts > 3) throw new Error("CHAT_REQUEST_RETRY_LIMIT");

        // 同一 requestId 的失败重试或超时接管不再次扣减每日额度，但仍计入频率窗口。
        if (!existing) {
          const actionCount = Number(dailyUsage.chat) || 0;
          if (actionCount >= policy.dailyQuota) throw new Error("CHAT_DAILY_QUOTA");
          dailyUsage.chat = actionCount + 1;
        }
        windowCount += 1;

        const pending = { key: requestKey, status: "pending", attempts, updatedAt: now };
        if (existingIndex >= 0) recentRequests.splice(existingIndex, 1);
        recentRequests.push(pending);
        const trimmed = recentRequests.slice(-MAX_RECENT_REQUESTS);
        await document.set({
          data: Object.assign(withoutDocumentId(state), {
            dayKey,
            dailyUsage,
            windowStartedAt,
            windowCount,
            recentRequests: trimmed,
            updatedAt: now
          })
        });
        outcome = { owner: true, cached: false, requestKey };
      });
    } catch (error) {
      const message = String(error && (error.message || error.errMsg) || "");
      if (message.includes("CHAT_REQUEST_PENDING")) {
        throw new PublicError(409, "这条消息仍在处理中，请稍等片刻");
      }
      if (message.includes("CHAT_REQUEST_RETRY_LIMIT")) {
        throw new PublicError(429, "这条消息重试次数过多，请重新发送一条消息");
      }
      if (message.includes("CHAT_RATE_LIMIT")) {
        throw new PublicError(429, "操作太频繁，请稍等一会儿再试");
      }
      if (message.includes("CHAT_DAILY_QUOTA")) {
        throw new PublicError(429, "今天的使用次数已达上限，请明天再来聊");
      }
      throw error;
    }
    return outcome;
  }

  async function complete(openid, requestKey, data) {
    await updateRequest(openid, requestKey, {
      status: "completed",
      reply: data.reply,
      updatedAt: Date.now()
    });
  }

  async function fail(openid, requestKey, error) {
    await updateRequest(openid, requestKey, {
      status: "failed",
      errorCode: Number(error && error.code) || 500,
      errorMessage: String(error && error.message || "请求失败").slice(0, 100),
      updatedAt: Date.now()
    });
  }

  async function updateRequest(openid, requestKey, patch) {
    const userKey = sha256(openid);
    await db.runTransaction(async transaction => {
      const document = transaction.collection(collection).doc(userKey);
      const snapshot = await document.get();
      const state = snapshot && snapshot.data ? snapshot.data : {};
      const recentRequests = Array.isArray(state.recentRequests)
        ? state.recentRequests.slice()
        : [];
      const index = recentRequests.findIndex(item => item && item.key === requestKey);
      if (index < 0) return;
      recentRequests[index] = Object.assign({}, recentRequests[index], patch);
      await document.set({
        data: Object.assign(withoutDocumentId(state), {
          recentRequests: recentRequests.slice(-MAX_RECENT_REQUESTS),
          updatedAt: Date.now()
        })
      });
    });
  }

  return { claim, complete, fail };
}

function normalizeRequestId(value) {
  const requestId = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) {
    throw new PublicError(400, "聊天请求编号无效，请重新发送");
  }
  return requestId;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function withoutDocumentId(state) {
  const copy = Object.assign({}, state || {});
  delete copy._id;
  return copy;
}

async function ensureUsageDocument(db, collectionName, userKey, now, dayKey) {
  const collection = db.collection(collectionName);
  const result = await collection.where({ _id: userKey }).limit(1).get();
  if (result && Array.isArray(result.data) && result.data.length) return;
  try {
    await collection.add({
      data: {
        _id: userKey,
        dayKey,
        dailyUsage: {},
        windowStartedAt: now,
        windowCount: 0,
        recentRequests: [],
        updatedAt: now
      }
    });
  } catch (error) {
    const detail = [error && error.errCode, error && error.code, error && error.errMsg, error && error.message]
      .filter(Boolean)
      .join(" ");
    if (!/DUPLICATE_KEY|-502001|already exists|duplicate/i.test(detail)) throw error;
  }
}

module.exports = { createChatIdempotency };

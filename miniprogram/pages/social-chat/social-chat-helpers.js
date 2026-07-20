const EMPTY_CONTACT_EXCHANGE = { status: "none", myContact: null, peerContact: null };
const EMPTY_MESSAGE_POLICY = { limited: false, blocked: false, remainingBeforeReply: null, tip: "" };

function normalizeMessagePolicy(value) {
  const source = value && typeof value === "object" ? value : EMPTY_MESSAGE_POLICY;
  const limited = source.limited === true;
  const remainingBeforeReply = limited ? Math.max(0, Math.min(3, Number(source.remainingBeforeReply) || 0)) : null;
  const blocked = limited && remainingBeforeReply <= 0;
  return {
    limited,
    blocked,
    remainingBeforeReply,
    tip: blocked
      ? "已发送 3 条，等待对方回复后可以继续"
      : (limited ? `对方回复前，还可以发送 ${remainingBeforeReply} 条消息` : "")
  };
}

function normalizeContactExchange(value) {
  const source = value && typeof value === "object" ? value : EMPTY_CONTACT_EXCHANGE;
  const allowed = ["none", "pending_sent", "pending_received", "accepted", "declined"];
  return {
    status: allowed.includes(source.status) ? source.status : "none",
    myContact: normalizeSharedContact(source.myContact),
    peerContact: normalizeSharedContact(source.peerContact)
  };
}

function normalizeSharedContact(value) {
  if (!value || typeof value !== "object") return null;
  return { items: Array.isArray(value.items) ? value.items.slice() : [], updatedAt: Number(value.updatedAt) || 0 };
}

function contactExchangeSummary(exchange) {
  if (!exchange || exchange.status !== "accepted") return "";
  if (exchange.myContact && exchange.peerContact) return "双方都已分享，点击查看";
  if (exchange.peerContact) return "TA 已分享联系方式，点击查看";
  if (exchange.myContact) return "你已分享，等待 TA 决定";
  return "双方已同意，按需选择分享";
}

function soloTestActionMessage(action) {
  const messages = {
    message: "测试伙伴已回复",
    request_contact: "测试伙伴已发来交换申请",
    accept_contact: "测试伙伴已同意交换",
    share_contact: "测试伙伴已分享测试微信号"
  };
  return messages[action] || "测试伙伴操作完成";
}

function isRelationshipEndedError(error) {
  const message = String(error && error.message || "");
  return message.includes("伙伴关系已解除") ||
    message.includes("只有已经互相确认的伙伴") ||
    message.includes("当前无法查看这段会话") ||
    message.includes("当前无法向对方发送消息");
}

function decorateMessages(items) {
  return (Array.isArray(items) ? items : []).map((item, index) => Object.assign({}, item, {
    id: item.id || `legacy-${index}`,
    timeText: formatMessageTime(item.createdAt)
  }));
}

function mergeMessages(first, second) {
  const byId = new Map();
  (Array.isArray(first) ? first : []).concat(Array.isArray(second) ? second : []).forEach(message => {
    if (message && message.id) byId.set(message.id, message);
  });
  return Array.from(byId.values()).sort((a, b) => {
    const timeDifference = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    return timeDifference || String(a.id).localeCompare(String(b.id));
  });
}

function conversationSignature(messages, contactExchange, messagePolicy) {
  const list = Array.isArray(messages) ? messages : [];
  const latest = list[list.length - 1] || {};
  const exchange = contactExchange && typeof contactExchange === "object" ? contactExchange : {};
  const policy = messagePolicy && typeof messagePolicy === "object" ? messagePolicy : {};
  return [
    latest.id || "", latest.createdAt || 0, list.length, exchange.status || "none",
    exchange.myContact && exchange.myContact.updatedAt || 0,
    exchange.peerContact && exchange.peerContact.updatedAt || 0,
    policy.limited ? 1 : 0,
    policy.remainingBeforeReply === null ? "" : policy.remainingBeforeReply
  ].join(":");
}

function formatMessageTime(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

module.exports = {
  EMPTY_CONTACT_EXCHANGE,
  EMPTY_MESSAGE_POLICY,
  normalizeMessagePolicy,
  normalizeContactExchange,
  contactExchangeSummary,
  soloTestActionMessage,
  isRelationshipEndedError,
  decorateMessages,
  mergeMessages,
  conversationSignature
};

const MAX_MESSAGE_CHARACTERS = 500;
const MAX_CONTEXT_MESSAGES = 12;
const MAX_CONTEXT_CHARACTERS = 4000;
const MAX_CONTEXT_ITEM_CHARACTERS = 800;
const MAX_REPLY_CHARACTERS = 1200;

class PublicError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PublicError";
    this.code = code;
  }
}

function countCharacters(value) {
  return Array.from(typeof value === "string" ? value : "").length;
}

function trimToCharacters(value, maximum) {
  return Array.from(value).slice(0, maximum).join("");
}

function normalizeMessage(value) {
  const message = typeof value === "string" ? value.trim() : "";
  if (!message) throw new PublicError(400, "消息不能为空");
  if (countCharacters(message) > MAX_MESSAGE_CHARACTERS) {
    throw new PublicError(400, `每条消息不能超过 ${MAX_MESSAGE_CHARACTERS} 个字符`);
  }
  return message;
}

function normalizeReply(value) {
  const reply = typeof value === "string" ? value.trim() : "";
  if (!reply) throw new PublicError(502, "AI 没有返回有效回复");
  return trimToCharacters(reply, MAX_REPLY_CHARACTERS);
}

function buildConversation(history, currentMessage) {
  if (!Array.isArray(history)) return [];

  const normalized = [];
  history.slice(-MAX_CONTEXT_MESSAGES * 2).forEach(item => {
    if (!item || (item.role !== "user" && item.role !== "assistant")) return;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) return;
    normalized.push({
      role: item.role,
      content: trimToCharacters(content, MAX_CONTEXT_ITEM_CHARACTERS)
    });
  });

  const last = normalized[normalized.length - 1];
  if (last && last.role === "user" && last.content === currentMessage) normalized.pop();

  const selected = [];
  let characterCount = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const item = normalized[index];
    const itemCharacters = countCharacters(item.content);
    if (characterCount + itemCharacters > MAX_CONTEXT_CHARACTERS) break;
    selected.unshift(item);
    characterCount += itemCharacters;
    if (selected.length >= MAX_CONTEXT_MESSAGES) break;
  }
  return selected;
}

function readPositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function getShanghaiDayKey(timestamp) {
  const chinaOffsetMilliseconds = 8 * 60 * 60 * 1000;
  return new Date(timestamp + chinaOffsetMilliseconds).toISOString().slice(0, 10);
}

module.exports = {
  MAX_REPLY_CHARACTERS,
  PublicError,
  buildConversation,
  countCharacters,
  getShanghaiDayKey,
  normalizeMessage,
  normalizeReply,
  readPositiveInteger
};

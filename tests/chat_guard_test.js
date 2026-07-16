const assert = require("assert");
const guard = require("../cloudfunctions/chat/chat-guard");
const chatService = require("../miniprogram/services/chat");

function expectPublicError(fn, code) {
  assert.throws(fn, error => error instanceof guard.PublicError && error.code === code);
}

assert.strictEqual(guard.normalizeMessage("  您好  "), "您好");
expectPublicError(() => guard.normalizeMessage(""), 400);
expectPublicError(() => guard.normalizeMessage("你".repeat(501)), 400);

const rawHistory = [
  { role: "system", content: "不能由客户端注入系统消息" },
  { role: "assistant", content: "您好，我是云团" },
  { role: "user", content: "我昨天去散步了" },
  { role: "assistant", content: "散步时感觉怎么样？" },
  { role: "user", content: "今天想继续聊聊" }
];
const context = guard.buildConversation(rawHistory, "今天想继续聊聊");
assert.deepStrictEqual(context, [
  { role: "assistant", content: "您好，我是云团" },
  { role: "user", content: "我昨天去散步了" },
  { role: "assistant", content: "散步时感觉怎么样？" }
]);

const longHistory = Array.from({ length: 30 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  content: String(index).padStart(2, "0") + "字".repeat(798)
}));
const limited = guard.buildConversation(longHistory, "新消息");
assert.ok(limited.length <= guard.MAX_CONTEXT_MESSAGES);
assert.ok(limited.reduce((sum, item) => sum + guard.countCharacters(item.content), 0) <=
  guard.MAX_CONTEXT_CHARACTERS);

const clientContext = chatService.buildContext(rawHistory);
assert.ok(clientContext.every(item => item.role === "user" || item.role === "assistant"));
assert.ok(clientContext.every(item => !Object.prototype.hasOwnProperty.call(item, "id")));

const speechSource = "第一句比较短。第二句稍微长一点，用来验证语音会优先按标点切分。" +
  "第三句继续补充内容，确保后续部分也会保留下来。".repeat(3);
const speechSegments = chatService.splitSpeechText(speechSource);
assert.ok(speechSegments.length >= 2 && speechSegments.length <= 4);
assert.ok(speechSegments.every(segment => Array.from(segment).length <= 40));
assert.ok(Array.from(speechSegments.join("")).length <= 150);

assert.strictEqual(
  guard.getShanghaiDayKey(Date.parse("2026-07-15T16:00:00.000Z")),
  "2026-07-16"
);

console.log("chat guard tests passed");

const assert = require("assert");
const { createStreamReplyRenderer } = require("../miniprogram/pages/chat/stream-reply-renderer");

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
let callback = null;
global.setTimeout = next => { callback = next; return 1; };
global.clearTimeout = () => { callback = null; };

try {
  const updates = [];
  const persisted = [];
  const renderer = createStreamReplyRenderer(
    { setData(data) { updates.push(data); } },
    { onPersist(messages) { persisted.push(messages); } }
  );
  const baseMessages = [{ id: "user-1", role: "user", content: "你好" }];
  renderer.schedule({
    baseMessages,
    reply: { id: "reply-1", role: "assistant", content: "第一", status: "streaming" },
    uiState: { thinking: false }
  });
  renderer.schedule({
    baseMessages,
    reply: { id: "reply-1", role: "assistant", content: "第一段", status: "streaming" },
    uiState: { thinking: false }
  });
  assert.strictEqual(updates.length, 0);
  callback();
  assert.strictEqual(updates.length, 1);
  assert.strictEqual(updates[0].messages[1].content, "第一段");

  renderer.schedule({
    baseMessages,
    reply: { id: "reply-1", role: "assistant", content: "第一段完成", status: "streaming" },
    uiState: { thinking: false }
  });
  renderer.flush();
  assert.strictEqual(updates.length, 2);
  assert.strictEqual(updates[1]["messages[1].content"], "第一段完成");
  assert.strictEqual(persisted.length, 2);
  console.log("chat stream renderer tests passed");
} finally {
  global.setTimeout = originalSetTimeout;
  global.clearTimeout = originalClearTimeout;
}

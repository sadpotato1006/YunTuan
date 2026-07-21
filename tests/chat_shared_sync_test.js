const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
["chat-guard.js", "chat-idempotency.js"].forEach(file => {
  const normal = fs.readFileSync(path.join(root, "cloudfunctions", "chat", file), "utf8");
  const streaming = fs.readFileSync(path.join(root, "cloudfunctions", "chat-stream", file), "utf8");
  assert.strictEqual(streaming, normal, `${file} 必须由共享源同步生成`);
});

console.log("chat shared sync tests passed");

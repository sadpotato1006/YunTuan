const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const files = ["chat-guard.js", "chat-idempotency.js"];
const checkOnly = process.argv.includes("--check");
let drifted = false;

files.forEach(file => {
  const source = path.join(root, "cloudfunctions", "chat", file);
  const target = path.join(root, "cloudfunctions", "chat-stream", file);
  const expected = fs.readFileSync(source, "utf8");
  const actual = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (actual === expected) return;
  drifted = true;
  if (!checkOnly) fs.writeFileSync(target, expected, "utf8");
});

if (checkOnly && drifted) {
  console.error("聊天公共逻辑副本已漂移，请运行 node scripts/sync-chat-shared.js");
  process.exitCode = 1;
} else if (!checkOnly) {
  console.log(drifted ? "聊天公共逻辑已同步" : "聊天公共逻辑无需同步");
}

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, "database", "required-indexes.json"),
  "utf8"
));
const socialSource = fs.readFileSync(path.join(root, "cloudfunctions", "social", "index.js"), "utf8");

function findIndex(collection, name) {
  return manifest.indexes.find(index => index.collection === collection && index.name === name);
}

assert.strictEqual(manifest.environmentId, "cloudbase-d7g2y0azb4f5dcf00");
assert.deepStrictEqual(findIndex("social_messages", "idx_messages_conversation_created").fields, [
  { field: "conversationId", order: "asc" },
  { field: "createdAt", order: "desc" }
]);
assert.ok(socialSource.includes('.where({ conversationId, createdAt: createdAtCondition })'));
assert.ok(socialSource.includes('.orderBy("createdAt", direction === "after" ? "asc" : "desc")'));

console.log("database index manifest tests passed");

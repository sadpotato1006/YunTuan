const assert = require("assert");
const Module = require("module");

const now = Date.now();
const collections = new Map();
const deletedFiles = [];
function collection(name) { if (!collections.has(name)) collections.set(name, new Map()); return collections.get(name); }
function matches(value, condition) {
  if (!condition || typeof condition !== "object" || !condition.op) return value === condition;
  if (condition.op === "gt") return value > condition.value;
  if (condition.op === "lte") return value <= condition.value;
  return condition.items.every(item => matches(value, item));
}
const command = {
  gt: value => ({ op: "gt", value }),
  lte: value => ({ op: "lte", value }),
  and: (...items) => ({ op: "and", items })
};
const db = {
  command,
  collection(name) {
    return {
      where(query) {
        return {
          limit(size) {
            return { async get() {
              const data = Array.from(collection(name).values()).filter(record =>
                Object.keys(query).every(key => matches(record[key], query[key]))
              ).slice(0, size);
              return { data: JSON.parse(JSON.stringify(data)) };
            } };
          }
        };
      },
      doc(id) { return { async remove() { collection(name).delete(id); } }; }
    };
  }
};
const cloud = {
  DYNAMIC_CURRENT_ENV: "test", init() {}, database: () => db,
  async deleteFile({ fileList }) { deletedFiles.push(...fileList); }
};
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  return request === "wx-server-sdk" ? cloud : originalLoad.call(this, request, parent, isMain);
};
const cleanup = require("../cloudfunctions/social-cleanup/index");
Module._load = originalLoad;

function seed(name, id, data) { collection(name).set(id, Object.assign({ _id: id }, data)); }
seed("social_tokens", "expired", { expiresAt: now - 1000 });
seed("social_tokens", "active", { expiresAt: now + 60000 });
seed("social_encounter_refs", "ref", { expiresAt: now - 1000 });
seed("social_resolve_usage", "usage", { updatedAt: now - 8 * 86400000 });
const qr = "cloud://test/social-contact-qrs/expired.jpg";
seed("social_contact_files", "qr", { status: "staged", expiresAt: now - 1000, fileId: qr });
seed("social_conversations", "ended", { status: "ended", updatedAt: now - 91 * 86400000 });
seed("social_messages", "message", { conversationId: "ended" });
seed("social_contact_requests", "ended", { status: "cancelled" });

(async () => {
  const result = await cleanup.main({});
  assert.strictEqual(result.code, 0);
  assert.ok(!collection("social_tokens").has("expired"));
  assert.ok(collection("social_tokens").has("active"));
  assert.ok(!collection("social_encounter_refs").has("ref"));
  assert.ok(!collection("social_resolve_usage").has("usage"));
  assert.ok(!collection("social_contact_files").has("qr"));
  assert.deepStrictEqual(deletedFiles, [qr]);
  assert.ok(!collection("social_conversations").has("ended"));
  assert.ok(!collection("social_messages").has("message"));
  assert.ok(!collection("social_contact_requests").has("ended"));
  console.log("social lifecycle tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require("assert");
const Module = require("module");

const documents = new Map();
let currentOpenid = "emotion-user-1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createCollection() {
  return {
    where(query) {
      return {
        limit() {
          return {
            async get() {
              return {
                data: Array.from(documents.values())
                  .filter(item => Object.keys(query).every(key => item[key] === query[key]))
                  .map(clone)
              };
            }
          };
        },
        async remove() {
          Array.from(documents.entries()).forEach(([id, item]) => {
            if (Object.keys(query).every(key => item[key] === query[key])) documents.delete(id);
          });
          return {};
        }
      };
    },
    doc(id) {
      return {
        async set(options) {
          documents.set(id, Object.assign({ _id: id }, clone(options.data)));
          return {};
        }
      };
    }
  };
}

const cloudStub = {
  DYNAMIC_CURRENT_ENV: "test",
  init() {},
  database() { return { collection: createCollection }; },
  getWXContext() { return { OPENID: currentOpenid }; }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "wx-server-sdk") return cloudStub;
  return originalLoad.call(this, request, parent, isMain);
};
const emotionFunction = require("../cloudfunctions/emotion/index");
Module._load = originalLoad;

(async () => {
  const empty = await emotionFunction.main({ action: "getEmotionRecords" });
  assert.strictEqual(empty.code, 0);
  assert.deepStrictEqual(empty.data.records, []);

  const options = await emotionFunction.main({ action: "getEmotionOptions" });
  assert.strictEqual(options.code, 0);
  assert.ok(options.data.options.some(item => item.name === "开心"));

  const first = await emotionFunction.main({
    action: "addEmotionRecord",
    name: "开心",
    note: "今天和老朋友聊了会儿天。"
  });
  assert.strictEqual(first.code, 0);
  assert.strictEqual(first.data.records.length, 1);
  assert.strictEqual(first.data.record.name, "开心");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(first.data.record, "score"), false);
  assert.strictEqual(first.data.record.note, "今天和老朋友聊了会儿天。");
  assert.strictEqual(first.data.record.noteCustomized, true);

  const updated = await emotionFunction.main({
    action: "addEmotionRecord",
    name: "平静",
    note: "   "
  });
  assert.strictEqual(updated.code, 0);
  assert.strictEqual(updated.data.records.length, 1);
  assert.strictEqual(updated.data.records[0].name, "平静");
  assert.strictEqual(updated.data.records[0].note, "今天心里很安稳，平平淡淡也很好。");
  assert.strictEqual(updated.data.records[0].noteCustomized, false);

  const defaultTextSubmitted = await emotionFunction.main({
    action: "addEmotionRecord",
    name: "开心",
    note: "今天心情很好，想把这份快乐记下来。"
  });
  assert.strictEqual(defaultTextSubmitted.code, 0);
  assert.strictEqual(defaultTextSubmitted.data.record.note, "今天心情很好，想把这份快乐记下来。");
  assert.strictEqual(defaultTextSubmitted.data.record.noteCustomized, false);

  currentOpenid = "legacy-emotion-user";
  const legacyOwnerKey = require("crypto").createHash("sha256").update(currentOpenid).digest("hex");
  documents.set("legacy-record", {
    _id: "legacy-record",
    ownerKey: legacyOwnerKey,
    dayKey: "2026-07-16",
    date: "7月16日",
    name: "一般",
    score: 70
  });
  const legacyRecords = await emotionFunction.main({ action: "getEmotionRecords" });
  assert.strictEqual(legacyRecords.code, 0);
  assert.strictEqual(legacyRecords.data.records[0].note, "今天心情比较平常，慢慢照顾好自己。");
  assert.strictEqual(legacyRecords.data.records[0].noteCustomized, false);

  currentOpenid = "emotion-user-2";
  const isolated = await emotionFunction.main({ action: "getEmotionSummary" });
  assert.strictEqual(isolated.code, 0);
  assert.strictEqual(isolated.data.latest, null);

  const invalid = await emotionFunction.main({ action: "addEmotionRecord", name: "不存在" });
  assert.strictEqual(invalid.code, 400);

  const noteTooLong = await emotionFunction.main({
    action: "addEmotionRecord",
    name: "开心",
    note: "记".repeat(101)
  });
  assert.strictEqual(noteTooLong.code, 400);

  currentOpenid = "emotion-user-1";
  const deleted = await emotionFunction.main({ action: "deleteMyEmotionRecords" });
  assert.strictEqual(deleted.code, 0);
  assert.deepStrictEqual((await emotionFunction.main({ action: "getEmotionRecords" })).data.records, []);
  console.log("emotion cloud function tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

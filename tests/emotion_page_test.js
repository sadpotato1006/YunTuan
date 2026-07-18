const assert = require("assert");
const Module = require("module");

let pageDefinition = null;
let pageScrollCalls = 0;

const originalLoad = Module._load;
const originalPage = global.Page;
const originalWx = global.wx;

Module._load = function load(request, parent, isMain) {
  if (parent && /miniprogram[\\/]pages[\\/]emotion[\\/]emotion\.js$/.test(parent.filename)) {
    if (request === "../../services/emotion") return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};
global.Page = definition => { pageDefinition = definition; };
global.wx = {
  pageScrollTo() { pageScrollCalls += 1; }
};

try {
  require("../miniprogram/pages/emotion/emotion");
} finally {
  Module._load = originalLoad;
  global.Page = originalPage;
}

try {
  assert.ok(pageDefinition);
  const page = Object.assign({}, pageDefinition, {
    data: Object.assign({}, pageDefinition.data),
    setData(patch, callback) {
      this.data = Object.assign({}, this.data, patch);
      if (typeof callback === "function") callback();
    }
  });

  page.data.options = [
    { name: "开心", icon: "😊", defaultNote: "今天心情很好，想把这份快乐记下来。" }
  ];
  page.data.selectedEmotion = "开心";
  page.data.noteValue = "   ";
  page.data.noteIsDefault = false;
  page.onNoteBlur();
  assert.strictEqual(page.data.noteValue, "今天心情很好，想把这份快乐记下来。");
  assert.strictEqual(page.data.noteIsDefault, true);

  const now = new Date();
  const today = `${now.getMonth() + 1}月${now.getDate()}日`;
  page.data.records = [{
    id: "today-record",
    date: today,
    name: "开心",
    note: "今天心情很好，想把这份快乐记下来。",
    noteCustomized: false,
    isToday: true
  }];
  page.editTodayRecord({ currentTarget: { dataset: { id: "today-record" } } });
  assert.strictEqual(page.data.showCheckIn, true);
  assert.strictEqual(page.data.selectedEmotion, "开心");
  assert.strictEqual(page.data.noteIsDefault, true);
  assert.strictEqual(pageScrollCalls, 1);

  console.log("emotion page tests passed");
} finally {
  global.wx = originalWx;
}

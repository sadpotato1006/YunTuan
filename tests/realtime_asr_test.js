const assert = require("assert");
const Module = require("module");

const sentFrames = [];
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === "./chat" && parent && /yuntuan-realtime-asr\.js$/.test(parent.filename)) {
    return {
      getRealtimeAsrTicket() {
        return Promise.resolve({ data: { url: "wss://asr.example.test/session" } });
      }
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

global.wx = {
  connectSocket() {
    const handlers = {};
    const task = {
      onMessage(listener) { handlers.message = listener; },
      onError(listener) { handlers.error = listener; },
      onClose(listener) { handlers.close = listener; },
      send(options) {
        if (options.data instanceof ArrayBuffer) {
          sentFrames.push(new Uint8Array(options.data));
          options.success();
          return;
        }
        assert.strictEqual(options.data, JSON.stringify({ type: "end" }));
        options.success();
        setTimeout(() => {
          handlers.message({
            data: JSON.stringify({
              code: 0,
              result: { index: 0, slice_type: 2, voice_text_str: "你好云团" }
            })
          });
          handlers.message({ data: JSON.stringify({ code: 0, final: 1 }) });
        }, 0);
      },
      close() {
        if (handlers.close) handlers.close();
      }
    };
    setTimeout(() => {
      handlers.message({ data: JSON.stringify({ code: 0, message: "success" }) });
    }, 0);
    return task;
  }
};

const realtimeAsr = require("../miniprogram/services/yuntuan-realtime-asr");
Module._load = originalLoad;

(async () => {
  const resultPromise = realtimeAsr.start(7);
  const samples = new Int16Array(3200);
  samples[0] = 0x1234;
  samples[1] = -2;
  realtimeAsr.pushPcm(7, samples);
  realtimeAsr.finish(7).catch(() => {});

  assert.strictEqual(await resultPromise, "你好云团");
  assert.strictEqual(sentFrames.length, 1);
  assert.strictEqual(sentFrames[0].length, 6400);
  assert.strictEqual(sentFrames[0][0], 0x34);
  assert.strictEqual(sentFrames[0][1], 0x12);
  assert.strictEqual(sentFrames[0][2], 0xFE);
  assert.strictEqual(sentFrames[0][3], 0xFF);
  console.log("realtime_asr_test: ok");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

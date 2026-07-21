const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const firmware = read("hard/main.cpp");
assert.match(
  firmware,
  /if \(!g_micReady\) \{\s*g_capabilities &= ~\(\(uint16_t\)1 << CAP_AUDIO_UPLOAD\);\s*g_capabilities &= ~\(\(uint16_t\)1 << CAP_AUDIO_PLAYBACK\);/,
  "I2S 不可用时必须同时取消录音和播放能力"
);

const realtimeAsr = read("miniprogram/services/yuntuan-realtime-asr.js");
assert.match(realtimeAsr, /const PCM_FRAME_BYTES = 6400;[^\n]*200 ms/);
assert.match(realtimeAsr, /const SEND_INTERVAL_MS = 200;/);

console.log("voice chain regression tests passed");

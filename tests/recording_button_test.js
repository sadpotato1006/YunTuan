const assert = require("assert");
const fs = require("fs");
const path = require("path");

const firmware = fs.readFileSync(
  path.join(__dirname, "..", "hard", "main.cpp"),
  "utf8"
);

const idleStateStart = firmware.indexOf("case B_IDLE:");
const pressedStateStart = firmware.indexOf("case B_PRESSED:", idleStateStart);
assert.ok(idleStateStart >= 0 && pressedStateStart > idleStateStart);

const idleState = firmware.slice(idleStateStart, pressedStateStart);
assert.match(
  idleState,
  /g_audioState\s*==\s*AUDIO_RECORDING/
);
assert.match(idleState, /g_btnLongReported\s*=\s*true/);
assert.match(idleState, /finishAudioRecording\(false\)/);
assert.ok(
  idleState.indexOf("finishAudioRecording(false)") >= 0,
  "recording must stop on the second debounced press"
);
assert.match(firmware, /AUDIO_STATUS_CAPTURE_STOPPED\s+0x13/);
assert.match(firmware, /BTN_DEBOUNCE_MS/);
assert.match(firmware, /now - g_btnRawChangedAt >= BTN_DEBOUNCE_MS/);
assert.match(firmware, /previous recording still transferring; press ignored/);
assert.doesNotMatch(firmware, /capture already stopped; transfer still active/);
assert.match(firmware, /g_audioNextSendAt\s*=\s*millis\(\)\s*\+\s*50/);
assert.match(firmware, /g_audioNextSendAt\s*=\s*now\s*\+\s*100/);
assert.match(firmware, /Never indicate END re-entrantly/);
assert.match(firmware, /AUDIO_RETAINED_TIMEOUT_MS\s+30000UL/);
assert.match(firmware, /retained transfer hard timeout; recording released/);
assert.match(firmware, /repeated non-progress ACK; aborting session/);
assert.match(firmware, /AUDIO_MAX_DURATION_MS/);
assert.match(firmware, /pollPendingAudioError\(now\)/);
assert.match(firmware, /pending terminal error delivered/);

const miniAudio = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "services", "yuntuan-audio.js"),
  "utf8"
);
assert.match(miniAudio, /STATUS_CAPTURE_STOPPED\s*=\s*0x13/);
assert.match(miniAudio, /录音已停止，正在上传并识别/);
assert.match(miniAudio, /captureStopped:\s*false/);
assert.match(miniAudio, /session\.captureStopped\s*=\s*true/);
assert.match(miniAudio, /ACK_REPEAT_SUPPRESS_MS\s*=\s*400/);
assert.match(miniAudio, /async function drainAckQueue/);
assert.match(miniAudio, /忽略旧挂件录音结束状态/);
assert.match(miniAudio, /AUDIO_INACTIVITY_TIMEOUT_MS\s*=\s*6000/);
assert.match(miniAudio, /挂件语音传输超过 6 秒没有新数据，已自动重置/);
assert.match(miniAudio, /AUDIO_SESSION_TIMEOUT_MS\s*=\s*30000/);
assert.match(miniAudio, /AUDIO_CONTROL_WRITE_TIMEOUT_MS\s*=\s*1500/);
assert.match(miniAudio, /挂件语音会话超过 30 秒未完成，已自动重置/);
assert.match(miniAudio, /session\.captureStopped\s*=\s*true/);

console.log("recording_button_test: ok");

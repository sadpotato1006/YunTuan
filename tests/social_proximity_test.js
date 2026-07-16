const assert = require("assert");
const fs = require("fs");
const path = require("path");
const config = require("../miniprogram/config/ble");
const protocol = require("../miniprogram/utils/yuntuan-protocol");

const firmware = fs.readFileSync(
  path.join(__dirname, "..", "hard", "main.cpp"),
  "utf8"
);
const deviceService = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "services", "yuntuan-device.js"),
  "utf8"
);
const devicePage = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "device", "device.wxml"),
  "utf8"
);

assert.match(firmware, /SOCIAL_ENTER_RSSI_DBM\s+\(-65\)/);
assert.match(firmware, /SOCIAL_EXIT_RSSI_DBM\s+\(-72\)/);
assert.match(firmware, /SOCIAL_REQUIRED_SAMPLES\s+3/);
assert.match(firmware, /SOCIAL_PEER_COOLDOWN_MS\s+60000UL/);
assert.match(firmware, /setScanCallbacks\(new SocialScanCB\(\), true\)/);
assert.match(firmware, /setActiveScan\(false\)/);
assert.match(firmware, /setMaxResults\(0\)/);
assert.match(firmware, /BLE_GAP_CONN_MODE_UND\s*:\s*BLE_GAP_CONN_MODE_NON/);
assert.match(firmware, /g_preferences\.putBool\("social"/);
assert.match(firmware, /EVT_SOCIAL_ENCOUNTER\s+0x24/);
assert.match(firmware, /SOCIAL_EVENT_QUEUE_CAPACITY\s+4/);
assert.match(firmware, /pEventTx->setCallbacks\(new EventTxCB\(\)\)/);
assert.match(deviceService, /event\.type === "socialEncounter"/);
assert.match(deviceService, /title: "遇到云团伙伴啦"/);
assert.match(devicePage, /device\.lastEncounterAt/);
assert.doesNotMatch(
  firmware,
  /g_advertising->addServiceUUID\(BATTERY_SERVICE_UUID\)/,
  "legacy advertisement must retain room for the social beacon"
);
assert.strictEqual(3 + 18 + 10, 31, "flags + 128-bit UUID + manufacturer AD must fit legacy advertising");
assert.strictEqual(config.protocolMinor, 0x05);
assert.strictEqual(config.COMMANDS.SOCIAL_ENCOUNTER, 0x24);
assert.strictEqual(config.capabilities.socialEncounter, 1 << 10);

const encounterFrame = protocol.createEvent(
  config.COMMANDS.SOCIAL_ENCOUNTER,
  new Uint8Array([0x78, 0x56, 0x34, 0x12, 0xbf, 0x2c, 0x01, 0x00, 0x00])
);
assert.deepStrictEqual(protocol.parseEvent(encounterFrame), {
  type: "socialEncounter",
  command: 0x24,
  peerToken: 0x12345678,
  rssi: -65,
  ageSeconds: 300
});

function createPeer() {
  return { filtered: null, near: 0, far: 0, inside: false, cooldownUntil: 0 };
}

function sample(peer, rssi, now) {
  peer.filtered = peer.filtered === null
    ? rssi * 4
    : Math.trunc((peer.filtered * 3 + rssi * 4) / 4);

  let triggered = false;
  if (peer.filtered >= -65 * 4) {
    peer.far = 0;
    peer.near = Math.min(3, peer.near + 1);
    if (!peer.inside && peer.near >= 3) {
      peer.inside = true;
      peer.near = 0;
      if (now >= peer.cooldownUntil) {
        peer.cooldownUntil = now + 60000;
        triggered = true;
      }
    }
  } else if (peer.filtered <= -72 * 4) {
    peer.near = 0;
    peer.far = Math.min(3, peer.far + 1);
    if (peer.far >= 3) {
      peer.inside = false;
      peer.far = 0;
    }
  } else {
    peer.near = 0;
    peer.far = 0;
  }
  return triggered;
}

const peer = createPeer();
assert.strictEqual(sample(peer, -60, 1000), false);
assert.strictEqual(sample(peer, -60, 1100), false);
assert.strictEqual(sample(peer, -60, 1200), true, "third near sample triggers");
assert.strictEqual(sample(peer, -60, 1300), false, "remaining nearby does not retrigger");

for (let i = 0; i < 12; i++) sample(peer, -80, 2000 + i * 100);
assert.strictEqual(peer.inside, false, "sustained weak RSSI exits the near state");
assert.strictEqual(sample(peer, -55, 5000), false);
assert.strictEqual(sample(peer, -55, 5100), false);
assert.strictEqual(sample(peer, -55, 5200), false, "cooldown blocks a second trigger");

console.log("social proximity tests passed");

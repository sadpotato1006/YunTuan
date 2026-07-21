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
const partnersPage = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "partners", "partners.wxml"),
  "utf8"
);
const encountersPage = fs.readFileSync(
  path.join(__dirname, "..", "miniprogram", "pages", "encounters", "encounters.wxml"),
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
assert.match(firmware, /SOCIAL_EVENT_QUEUE_CAPACITY\s+20/);
assert.match(firmware, /CMD_ACK_SOCIAL_ENCOUNTER\s+0x08/);
assert.match(firmware, /CMD_SET_ALERT_SETTINGS\s+0x09/);
assert.match(firmware, /g_preferences\.putBool\("socialAlert"/);
assert.match(firmware, /g_preferences\.putBytes\(key, &snapshot/);
assert.match(firmware, /persistSocialEncounterQueue\(\)/);
assert.match(firmware, /acknowledgeSocialEncounter/);
assert.match(firmware, /if \(!pEventTx->notify\(frame, frameLen\)\)/);
assert.match(firmware, /pEventTx->setCallbacks\(new EventTxCB\(\)\)/);
assert.match(deviceService, /event\.type === "socialEncounter"/);
assert.match(deviceService, /title: "遇到云团伙伴啦"/);
assert.match(deviceService, /socialService\.resolveToken\(peerToken\)/);
assert.match(deviceService, /SOCIAL_REGISTRATION_REFRESH_MS/);
assert.match(deviceService, /retryLastEncounterProfile/);
assert.match(partnersPage, /class="encounter-entry card"/);
assert.match(partnersPage, /bindtap="openEncounters"/);
assert.match(encountersPage, /wx:for="\{\{records\}\}"/);
assert.match(encountersPage, /item\.profile/);
assert.doesNotMatch(
  firmware,
  /g_advertising->addServiceUUID\(BATTERY_SERVICE_UUID\)/,
  "legacy advertisement must retain room for the social beacon"
);
assert.strictEqual(3 + 18 + 10, 31, "flags + 128-bit UUID + manufacturer AD must fit legacy advertising");
assert.strictEqual(config.protocolMinor, 0x07);
assert.strictEqual(config.maxPayloadLength, 18);
assert.strictEqual(config.controlMinMTU, 31);
assert.strictEqual(config.COMMANDS.ACK_SOCIAL_ENCOUNTER, 0x08);
assert.strictEqual(config.COMMANDS.SET_ALERT_SETTINGS, 0x09);
assert.strictEqual(config.COMMANDS.SOCIAL_ENCOUNTER, 0x24);
assert.strictEqual(config.capabilities.socialEncounter, 1 << 10);
assert.strictEqual(config.capabilities.alertSettings, 1 << 11);

const encounterPayload = new Uint8Array(18);
encounterPayload.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
protocol.writeUint32LE(encounterPayload, 8, 0x12345678);
encounterPayload[12] = 0xbf;
protocol.writeUint32LE(encounterPayload, 13, 1700000000);
encounterPayload[17] = 0x01;
const encounterFrame = protocol.createEvent(config.COMMANDS.SOCIAL_ENCOUNTER, encounterPayload);
assert.deepStrictEqual(protocol.parseEvent(encounterFrame), {
  type: "socialEncounter",
  command: 0x24,
  encounterId: "0102030405060708",
  peerToken: 0x12345678,
  rssi: -65,
  occurredAt: 1700000000,
  timestampValid: true,
  flags: 1
});

const ackPayload = protocol.buildEncounterAckPayload("0102030405060708");
assert.deepStrictEqual(Array.from(ackPayload), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.strictEqual(protocol.encounterIdFromBytes(ackPayload), "0102030405060708");

const initializeIndex = deviceService.indexOf("async function initializeConnectedDevice");
const mtuNegotiationIndex = deviceService.indexOf("bleService.negotiateMTU(247", initializeIndex);
const eventSubscribeIndex = deviceService.indexOf("config.UUIDS.eventTx", initializeIndex);
assert.ok(mtuNegotiationIndex >= 0 && mtuNegotiationIndex < eventSubscribeIndex,
  "必须在订阅 Event TX 前协商可容纳 28 字节控制帧的 MTU");

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

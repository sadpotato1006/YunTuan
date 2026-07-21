const config = require("../config/ble");
const protocol = require("../utils/yuntuan-protocol");

const UUIDS = Object.assign({ status: config.UUIDS.protocolInfo }, config.UUIDS);
const SOCIAL_TOKEN_STORAGE_KEY = "yuntuan_simulator_social_token";
const SIMULATOR_CAPABILITIES = config.capabilities.battery |
  config.capabilities.socialMode |
  config.capabilities.findDevice |
  config.capabilities.buttonEvent |
  config.capabilities.timeSync |
  config.capabilities.socialEncounter |
  config.capabilities.alertSettings;
const startedAt = Date.now();
let battery = 78;
let socialMode = true;
let alertSettings = { socialReminder: true, vibration: true, sound: true };
let memorySocialToken = 0;
let encounterSequence = 0;

function createServices() {
  return [
    {
      uuid: UUIDS.batteryService,
      displayName: "Battery Service（模拟电量）",
      isPrimary: true,
      errorMessage: "",
      characteristics: [createCharacteristic(UUIDS.batteryLevel, "Battery Level（模拟电量）", {
        read: true,
        notify: true
      })]
    },
    {
      uuid: UUIDS.deviceInfoService,
      displayName: "Device Information（模拟设备信息）",
      isPrimary: true,
      errorMessage: "",
      characteristics: [
        createCharacteristic(UUIDS.modelNumber, "Model Number（模拟型号）", { read: true }),
        createCharacteristic(UUIDS.firmwareRevision, "Firmware Revision（模拟固件）", { read: true }),
        createCharacteristic(UUIDS.hardwareRevision, "Hardware Revision（模拟硬件）", { read: true })
      ]
    },
    {
      uuid: UUIDS.controlService,
      displayName: "Yuntuan Control（模拟自定义服务）",
      isPrimary: true,
      errorMessage: "",
      characteristics: [
        createCharacteristic(UUIDS.commandRx, "Command RX（模拟写入）", {
          write: true,
          writeNoResponse: true
        }),
        createCharacteristic(UUIDS.eventTx, "Event TX（模拟通知）", { notify: true }),
        createCharacteristic(UUIDS.protocolInfo, "Protocol Info（模拟协议）", { read: true })
      ]
    }
  ];
}

function createCharacteristic(uuid, displayName, properties) {
  const supported = [];
  if (properties.read) supported.push("Read");
  if (properties.write) supported.push("Write");
  if (properties.writeNoResponse) supported.push("WriteNoResponse");
  if (properties.notify) supported.push("Notify");
  if (properties.indicate) supported.push("Indicate");
  return {
    uuid,
    displayName,
    propertyText: supported.join(" / "),
    properties,
    canRead: Boolean(properties.read),
    canWrite: Boolean(properties.write || properties.writeNoResponse),
    canNotify: Boolean(properties.notify || properties.indicate),
    subscribed: false,
    lastValueHex: "",
    lastValueText: "",
    valueMeaning: "",
    lastUpdatedAt: ""
  };
}

function readValue(characteristicId) {
  const normalized = normalize(characteristicId);
  if (same(normalized, UUIDS.batteryLevel)) return new Uint8Array([78]).buffer;
  if (same(normalized, UUIDS.modelNumber)) return asciiToBuffer("YT-SIM-01");
  if (same(normalized, UUIDS.firmwareRevision)) return asciiToBuffer("0.8.0");
  if (same(normalized, UUIDS.hardwareRevision)) return asciiToBuffer("SIM-A1");
  if (same(normalized, UUIDS.protocolInfo)) return protocolInfoBytes().buffer;
  throw new Error("这个模拟特征值没有可读取数据");
}

function createWriteResponse(value) {
  const request = protocol.decodeFrame(value);
  if (request.isResponse || request.isEvent) throw new Error("模拟设备只接受请求帧");
  let statusCode = config.STATUS_CODES.OK;
  let data = new Uint8Array(0);

  if (request.command === config.COMMANDS.HELLO) {
    if (request.payload.length) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    data = protocolInfoBytes();
  } else if (request.command === config.COMMANDS.GET_STATUS) {
    if (request.payload.length) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    data = createStatusData();
  } else if (request.command === config.COMMANDS.SET_SOCIAL_MODE) {
    if (request.payload.length !== 1 || (request.payload[0] !== 0 && request.payload[0] !== 1)) {
      statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    } else {
      socialMode = request.payload[0] === 1;
      data = new Uint8Array([socialMode ? 1 : 0]);
    }
  } else if (request.command === config.COMMANDS.FIND_DEVICE) {
    if (request.payload.length !== 3) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
  } else if (request.command === config.COMMANDS.SET_TIME) {
    if (request.payload.length !== 4) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
  } else if (request.command === config.COMMANDS.PING) {
    if (request.payload.length !== 4) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    else data = request.payload;
  } else if (request.command === config.COMMANDS.GET_SOCIAL_TOKEN) {
    if (request.payload.length) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    else {
      data = new Uint8Array(4);
      protocol.writeUint32LE(data, 0, getSocialToken());
    }
  } else if (request.command === config.COMMANDS.ACK_SOCIAL_ENCOUNTER) {
    if (request.payload.length !== 8) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    else data = new Uint8Array([0]);
  } else if (request.command === config.COMMANDS.SET_ALERT_SETTINGS) {
    try {
      alertSettings = protocol.parseAlertSettingsData(request.payload);
      data = protocol.buildAlertSettingsPayload(alertSettings);
    } catch (error) {
      statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    }
  } else {
    statusCode = config.STATUS_CODES.UNKNOWN_COMMAND;
  }

  if (statusCode !== config.STATUS_CODES.OK) data = new Uint8Array(0);
  return {
    serviceId: UUIDS.controlService,
    characteristicId: UUIDS.eventTx,
    value: protocol.createResponse(request.command, request.sequence, statusCode, data)
  };
}

function createNotifyValue(characteristicId) {
  if (same(characteristicId, UUIDS.eventTx)) {
    return protocol.createEvent(
      config.COMMANDS.STATUS_CHANGED,
      new Uint8Array([battery, 0xFF, socialMode ? 1 : 0])
    );
  }
  return readValue(characteristicId);
}

function createSocialEncounterValue(peerTokenValue, rssiValue) {
  const peerToken = normalizeToken(peerTokenValue);
  if (peerToken === getSocialToken()) throw new Error("不能模拟遇见当前挂件自己");
  const rssi = Number.isInteger(Number(rssiValue))
    ? Math.max(-127, Math.min(20, Number(rssiValue)))
    : -55;
  const payload = new Uint8Array(18);
  payload.set(createEncounterId(), 0);
  protocol.writeUint32LE(payload, 8, peerToken);
  payload[12] = rssi & 0xFF;
  protocol.writeUint32LE(payload, 13, Math.floor(Date.now() / 1000));
  payload[17] = 0x01;
  return protocol.createEvent(config.COMMANDS.SOCIAL_ENCOUNTER, payload);
}

function getSocialToken() {
  if (memorySocialToken) return memorySocialToken;
  if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
    const saved = Number(wx.getStorageSync(SOCIAL_TOKEN_STORAGE_KEY));
    if (isValidToken(saved)) {
      memorySocialToken = saved >>> 0;
      return memorySocialToken;
    }
  }
  memorySocialToken = generateSocialToken();
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    try { wx.setStorageSync(SOCIAL_TOKEN_STORAGE_KEY, memorySocialToken); }
    catch (error) { console.warn("模拟挂件 Token 保存失败：", error && error.message); }
  }
  return memorySocialToken;
}

function generateSocialToken() {
  let token = 0;
  while (!token) {
    const randomHigh = Math.floor(Math.random() * 0x10000);
    const randomLow = Math.floor(Math.random() * 0x10000);
    token = ((randomHigh << 16) | randomLow) >>> 0;
  }
  return token;
}

function normalizeToken(value) {
  const token = Number(value);
  if (!isValidToken(token)) throw new Error("对方模拟 Token 格式不正确");
  return token >>> 0;
}

function isValidToken(value) {
  return Number.isInteger(value) && value > 0 && value <= 0xFFFFFFFF;
}

function createEncounterId() {
  encounterSequence = (encounterSequence + 1) & 0xFFFF;
  const bytes = new Uint8Array(8);
  let timestamp = Date.now();
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }
  bytes[6] = encounterSequence & 0xFF;
  bytes[7] = (encounterSequence >>> 8) & 0xFF;
  return bytes;
}

function protocolInfoBytes() {
  return new Uint8Array([
    config.protocolMajor,
    config.protocolMinor,
    SIMULATOR_CAPABILITIES & 0xFF,
    (SIMULATOR_CAPABILITIES >>> 8) & 0xFF,
    0,
    0
  ]);
}

function createStatusData() {
  const data = new Uint8Array(7);
  data[0] = battery;
  data[1] = 0xFF;
  data[2] = socialMode ? 1 : 0;
  protocol.writeUint32LE(data, 3, Math.floor((Date.now() - startedAt) / 1000));
  return data;
}

function asciiToBuffer(text) {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}

function normalize(value) {
  return String(value || "").replace(/-/g, "").toUpperCase();
}

function same(first, second) {
  return normalize(first) === normalize(second);
}

module.exports = {
  UUIDS,
  SIMULATOR_CAPABILITIES,
  createServices,
  readValue,
  createNotifyValue,
  createWriteResponse,
  createSocialEncounterValue,
  getSocialToken
};

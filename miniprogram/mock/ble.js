const config = require("../config/ble");
const protocol = require("../utils/yuntuan-protocol");

const UUIDS = Object.assign({ status: config.UUIDS.protocolInfo }, config.UUIDS);
const startedAt = Date.now();
let battery = 78;
let chargingState = 1;
let socialMode = true;

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
  if (same(normalized, UUIDS.firmwareRevision)) return asciiToBuffer("0.2.0");
  if (same(normalized, UUIDS.hardwareRevision)) return asciiToBuffer("SIM-A1");
  if (same(normalized, UUIDS.protocolInfo)) return new Uint8Array([1, 0, 0x1F, 0, 0, 0]).buffer;
  throw new Error("这个模拟特征值没有可读取数据");
}

function createWriteResponse(value) {
  const request = protocol.decodeFrame(value);
  if (request.isResponse || request.isEvent) throw new Error("模拟设备只接受请求帧");
  let statusCode = config.STATUS_CODES.OK;
  let data = new Uint8Array(0);

  if (request.command === config.COMMANDS.HELLO) {
    if (request.payload.length) statusCode = config.STATUS_CODES.INVALID_PAYLOAD;
    data = new Uint8Array([1, 0, 0x1F, 0, 0, 0]);
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
      new Uint8Array([battery, chargingState, socialMode ? 1 : 0])
    );
  }
  return readValue(characteristicId);
}

function createStatusData() {
  const data = new Uint8Array(7);
  data[0] = battery;
  data[1] = chargingState;
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
  createServices,
  readValue,
  createNotifyValue,
  createWriteResponse
};

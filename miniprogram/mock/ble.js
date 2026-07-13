const UUIDS = {
  batteryService: "0000180F-0000-1000-8000-00805F9B34FB",
  batteryLevel: "00002A19-0000-1000-8000-00805F9B34FB",
  deviceInfoService: "0000180A-0000-1000-8000-00805F9B34FB",
  modelNumber: "00002A24-0000-1000-8000-00805F9B34FB",
  firmwareRevision: "00002A26-0000-1000-8000-00805F9B34FB",
  hardwareRevision: "00002A27-0000-1000-8000-00805F9B34FB",
  controlService: "A92B1000-6E3B-4C5D-9F21-4A7C2D8E1B30",
  commandRx: "A92B1001-6E3B-4C5D-9F21-4A7C2D8E1B30",
  eventTx: "A92B1002-6E3B-4C5D-9F21-4A7C2D8E1B30",
  status: "A92B1003-6E3B-4C5D-9F21-4A7C2D8E1B30"
};

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
        createCharacteristic(UUIDS.status, "Protocol Status（模拟状态）", {
          read: true,
          notify: true
        })
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
  if (same(normalized, UUIDS.firmwareRevision)) return asciiToBuffer("0.1.0");
  if (same(normalized, UUIDS.hardwareRevision)) return asciiToBuffer("SIM-A1");
  if (same(normalized, UUIDS.status)) return new Uint8Array([1, 0, 78, 1]).buffer;
  throw new Error("这个模拟特征值没有可读取数据");
}

function createWriteResponse(value) {
  const input = new Uint8Array(value);
  const response = new Uint8Array(Math.min(input.length, 17) + 2);
  response[0] = 0x00;
  response[1] = input.length;
  response.set(input.slice(0, 17), 2);
  return {
    serviceId: UUIDS.controlService,
    characteristicId: UUIDS.eventTx,
    value: response.buffer
  };
}

function createNotifyValue(characteristicId) {
  if (same(characteristicId, UUIDS.eventTx)) {
    return new Uint8Array([0x20, 0x01, 78]).buffer;
  }
  return readValue(characteristicId);
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

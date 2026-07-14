const config = require("../config/ble");

const STATUS_MESSAGES = {
  [config.STATUS_CODES.UNKNOWN_COMMAND]: "设备不认识这个命令",
  [config.STATUS_CODES.INVALID_PAYLOAD]: "设备收到的数据格式不正确",
  [config.STATUS_CODES.BUSY]: "设备正忙，请稍后重试",
  [config.STATUS_CODES.UNAUTHORIZED]: "当前连接尚未通过设备认证",
  [config.STATUS_CODES.NOT_SUPPORTED]: "当前设备不支持这个功能",
  [config.STATUS_CODES.INTERNAL_ERROR]: "设备内部发生错误",
  [config.STATUS_CODES.CRC_ERROR]: "设备检测到通信校验错误",
  [config.STATUS_CODES.VERSION_INCOMPATIBLE]: "小程序与设备协议版本不兼容",
  [config.STATUS_CODES.LOW_BATTERY]: "设备电量过低，暂时无法执行",
  [config.STATUS_CODES.PHYSICAL_CONFIRM_REQUIRED]: "请先在挂件上进行实体确认"
};

function toBytes(value) {
  if (value === undefined || value === null) return new Uint8Array(0);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error("协议数据必须是 ArrayBuffer、TypedArray 或字节数组");
}

function crc16CcittFalse(value) {
  const bytes = toBytes(value);
  let crc = 0xFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc ^= bytes[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

function encodeFrame(options) {
  const frame = options || {};
  const payload = toBytes(frame.payload);
  if (payload.length > config.maxPayloadLength) {
    throw new Error(`第一阶段协议负载不能超过 ${config.maxPayloadLength} 字节`);
  }
  validateByte(frame.command, "Command");
  validateByte(frame.sequence, "Sequence");

  const bytes = new Uint8Array(10 + payload.length);
  bytes[0] = config.sof;
  bytes[1] = config.protocolVersion;
  bytes[2] = frame.flags === undefined ? config.flags.request : frame.flags;
  bytes[3] = frame.command;
  bytes[4] = frame.sequence;
  bytes[5] = 0;
  bytes[6] = 1;
  bytes[7] = payload.length;
  bytes.set(payload, 8);

  const crc = crc16CcittFalse(bytes.slice(1, 8 + payload.length));
  bytes[8 + payload.length] = crc & 0xFF;
  bytes[9 + payload.length] = (crc >>> 8) & 0xFF;
  return bytes.buffer;
}

function decodeFrame(value) {
  const bytes = toBytes(value);
  if (bytes.length < 10) throw new Error("协议帧长度不足 10 字节");
  if (bytes[0] !== config.sof) throw new Error("协议帧起始字节错误");
  if (bytes[1] !== config.protocolVersion) throw new Error("协议传输版本不兼容");
  if (bytes[5] !== 0 || bytes[6] !== 1) throw new Error("第一阶段协议不支持分片");

  const payloadLength = bytes[7];
  if (payloadLength > config.maxPayloadLength) throw new Error("协议负载长度超过第一阶段限制");
  if (bytes.length !== 10 + payloadLength) throw new Error("协议帧声明长度与实际长度不一致");

  const expectedCrc = bytes[8 + payloadLength] | (bytes[9 + payloadLength] << 8);
  const actualCrc = crc16CcittFalse(bytes.slice(1, 8 + payloadLength));
  if (actualCrc !== expectedCrc) {
    throw new Error(`协议帧 CRC 错误：期望 ${toHex16(expectedCrc)}，实际 ${toHex16(actualCrc)}`);
  }

  const flags = bytes[2];
  return {
    version: bytes[1],
    flags,
    command: bytes[3],
    sequence: bytes[4],
    payload: bytes.slice(8, 8 + payloadLength),
    isResponse: Boolean(flags & config.flags.response),
    isEvent: Boolean(flags & config.flags.event),
    authenticated: Boolean(flags & config.flags.authenticated)
  };
}

function createRequest(command, sequence, payload, authenticated) {
  return encodeFrame({
    flags: authenticated ? config.flags.authenticated : config.flags.request,
    command,
    sequence,
    payload
  });
}

function createResponse(command, sequence, statusCode, data, authenticated) {
  const responseData = toBytes(data);
  const payload = new Uint8Array(2 + responseData.length);
  writeUint16LE(payload, 0, statusCode);
  payload.set(responseData, 2);
  return encodeFrame({
    flags: config.flags.response | (authenticated ? config.flags.authenticated : 0),
    command,
    sequence,
    payload
  });
}

function createEvent(command, payload, authenticated) {
  return encodeFrame({
    flags: config.flags.event | (authenticated ? config.flags.authenticated : 0),
    command,
    sequence: 0,
    payload
  });
}

function parseResponse(frameOrValue) {
  const frame = isDecodedFrame(frameOrValue) ? frameOrValue : decodeFrame(frameOrValue);
  if (!frame.isResponse || frame.isEvent) throw new Error("收到的数据不是命令响应");
  if (frame.payload.length < 2) throw new Error("命令响应缺少状态码");
  const statusCode = readUint16LE(frame.payload, 0);
  return {
    frame,
    statusCode,
    ok: statusCode === config.STATUS_CODES.OK,
    message: statusCode === config.STATUS_CODES.OK
      ? "success"
      : (STATUS_MESSAGES[statusCode] || `设备返回未知错误 0x${toHex16(statusCode)}`),
    data: frame.payload.slice(2)
  };
}

function assertSuccessfulResponse(frameOrValue) {
  const response = parseResponse(frameOrValue);
  if (!response.ok) {
    const error = new Error(response.message);
    error.statusCode = response.statusCode;
    throw error;
  }
  return response;
}

function parseProtocolInfo(value) {
  const bytes = toBytes(value);
  if (bytes.length !== 6) throw new Error("Protocol Info 必须为 6 字节");
  return {
    protocolMajor: bytes[0],
    protocolMinor: bytes[1],
    capabilities: readUint16LE(bytes, 2),
    securityMode: bytes[4],
    reserved: bytes[5]
  };
}

function parseHelloData(value) {
  const bytes = toBytes(value);
  if (bytes.length !== 6) throw new Error("HELLO 响应数据必须为 6 字节");
  return {
    protocolMajor: bytes[0],
    protocolMinor: bytes[1],
    capabilities: readUint16LE(bytes, 2),
    securityMode: bytes[4],
    bindState: bytes[5]
  };
}

function parseStatusData(value) {
  const bytes = toBytes(value);
  if (bytes.length !== 7) throw new Error("GET_STATUS 响应数据必须为 7 字节");
  return {
    battery: bytes[0] === 0xFF ? null : bytes[0],
    chargingState: bytes[1],
    socialMode: parseBoolean(bytes[2], "SocialMode"),
    uptime: readUint32LE(bytes, 3)
  };
}

function parseSocialModeData(value) {
  const bytes = toBytes(value);
  if (bytes.length !== 1) throw new Error("SET_SOCIAL_MODE 响应数据必须为 1 字节");
  return { socialMode: parseBoolean(bytes[0], "SocialMode") };
}

function buildSetSocialModePayload(enabled) {
  return new Uint8Array([enabled ? 1 : 0]);
}

function buildFindDevicePayload(alertType, duration) {
  if (![0, 1, 2].includes(alertType)) throw new Error("AlertType 只能为 0、1 或 2");
  if (!Number.isInteger(duration) || duration < 500 || duration > 10000) {
    throw new Error("查找设备时长必须为 500～10000 毫秒");
  }
  const payload = new Uint8Array(3);
  payload[0] = alertType;
  writeUint16LE(payload, 1, duration);
  return payload;
}

function buildUint32Payload(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) {
    throw new Error("数值必须为 uint32");
  }
  const payload = new Uint8Array(4);
  writeUint32LE(payload, 0, value);
  return payload;
}

function parseEvent(frameOrValue) {
  const frame = isDecodedFrame(frameOrValue) ? frameOrValue : decodeFrame(frameOrValue);
  if (!frame.isEvent || frame.isResponse || frame.sequence !== 0) throw new Error("收到的数据不是合法设备事件");
  const bytes = frame.payload;
  if (frame.command === config.COMMANDS.STATUS_CHANGED) {
    if (bytes.length !== 3) throw new Error("STATUS_CHANGED 必须为 3 字节");
    return {
      type: "statusChanged",
      command: frame.command,
      battery: bytes[0] === 0xFF ? null : bytes[0],
      chargingState: bytes[1],
      socialMode: parseBoolean(bytes[2], "SocialMode")
    };
  }
  if (frame.command === config.COMMANDS.BUTTON_EVENT) {
    if (bytes.length !== 5) throw new Error("BUTTON_EVENT 必须为 5 字节");
    if (![1, 2, 3].includes(bytes[0])) throw new Error("未知的设备按键类型");
    return { type: "button", command: frame.command, buttonType: bytes[0], unixTime: readUint32LE(bytes, 1) };
  }
  if (frame.command === config.COMMANDS.LOW_BATTERY) {
    if (bytes.length !== 1 || bytes[0] > 100) throw new Error("LOW_BATTERY 电量值非法");
    return { type: "lowBattery", command: frame.command, battery: bytes[0] };
  }
  if (frame.command === config.COMMANDS.BIND_WINDOW_CHANGED) {
    if (bytes.length !== 1 || bytes[0] > 2) throw new Error("BIND_WINDOW_CHANGED 状态非法");
    return { type: "bindWindowChanged", command: frame.command, bindState: bytes[0] };
  }
  return { type: "unknown", command: frame.command, payload: bytes };
}

function hasCapability(capabilities, capability) {
  return Boolean(capabilities & capability);
}

function readUint16LE(bytes, offset) {
  requireLength(bytes, offset, 2);
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  requireLength(bytes, offset, 4);
  return ((bytes[offset]) |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

function writeUint16LE(bytes, offset, value) {
  requireLength(bytes, offset, 2);
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
}

function writeUint32LE(bytes, offset, value) {
  requireLength(bytes, offset, 4);
  bytes[offset] = value & 0xFF;
  bytes[offset + 1] = (value >>> 8) & 0xFF;
  bytes[offset + 2] = (value >>> 16) & 0xFF;
  bytes[offset + 3] = (value >>> 24) & 0xFF;
}

function parseBoolean(value, fieldName) {
  if (value !== 0 && value !== 1) throw new Error(`${fieldName || "布尔字段"} 只能为 0 或 1`);
  return value === 1;
}

function validateByte(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFF) throw new Error(`${name} 必须为 0～255`);
}

function requireLength(bytes, offset, length) {
  if (!bytes || offset < 0 || bytes.length < offset + length) throw new Error("协议数据长度不足");
}

function isDecodedFrame(value) {
  return value && typeof value === "object" && value.payload instanceof Uint8Array && value.command !== undefined;
}

function toHex16(value) {
  return (value & 0xFFFF).toString(16).padStart(4, "0").toUpperCase();
}

module.exports = {
  toBytes,
  crc16CcittFalse,
  encodeFrame,
  decodeFrame,
  createRequest,
  createResponse,
  createEvent,
  parseResponse,
  assertSuccessfulResponse,
  parseProtocolInfo,
  parseHelloData,
  parseStatusData,
  parseSocialModeData,
  buildSetSocialModePayload,
  buildFindDevicePayload,
  buildUint32Payload,
  parseEvent,
  hasCapability,
  readUint16LE,
  readUint32LE,
  writeUint16LE,
  writeUint32LE
};

const UUIDS = {
  batteryService: "0000180F-0000-1000-8000-00805F9B34FB",
  batteryLevel: "00002A19-0000-1000-8000-00805F9B34FB",
  deviceInfoService: "0000180A-0000-1000-8000-00805F9B34FB",
  modelNumber: "00002A24-0000-1000-8000-00805F9B34FB",
  serialNumber: "00002A25-0000-1000-8000-00805F9B34FB",
  firmwareRevision: "00002A26-0000-1000-8000-00805F9B34FB",
  hardwareRevision: "00002A27-0000-1000-8000-00805F9B34FB",
  controlService: "A92B1000-6E3B-4C5D-9F21-4A7C2D8E1B30",
  commandRx: "A92B1001-6E3B-4C5D-9F21-4A7C2D8E1B30",
  eventTx: "A92B1002-6E3B-4C5D-9F21-4A7C2D8E1B30",
  protocolInfo: "A92B1003-6E3B-4C5D-9F21-4A7C2D8E1B30",
  audioService: "A92B2000-6E3B-4C5D-9F21-4A7C2D8E1B30",
  audioControl: "A92B2001-6E3B-4C5D-9F21-4A7C2D8E1B30",
  audioData: "A92B2002-6E3B-4C5D-9F21-4A7C2D8E1B30",
  audioStatus: "A92B2003-6E3B-4C5D-9F21-4A7C2D8E1B30",
  ttsService: "A92B3000-6E3B-4C5D-9F21-4A7C2D8E1B30",
  ttsControl: "A92B3001-6E3B-4C5D-9F21-4A7C2D8E1B30",
  ttsData: "A92B3002-6E3B-4C5D-9F21-4A7C2D8E1B30",
  ttsStatus: "A92B3003-6E3B-4C5D-9F21-4A7C2D8E1B30"
};

const COMMANDS = {
  HELLO: 0x01,
  GET_STATUS: 0x02,
  SET_SOCIAL_MODE: 0x03,
  FIND_DEVICE: 0x04,
  SET_TIME: 0x05,
  PING: 0x06,
  GET_SOCIAL_TOKEN: 0x07,
  ACK_SOCIAL_ENCOUNTER: 0x08,
  SET_ALERT_SETTINGS: 0x09,
  STATUS_CHANGED: 0x20,
  BUTTON_EVENT: 0x21,
  LOW_BATTERY: 0x22,
  BIND_WINDOW_CHANGED: 0x23,
  SOCIAL_ENCOUNTER: 0x24
};

const STATUS_CODES = {
  OK: 0x0000,
  UNKNOWN_COMMAND: 0x0001,
  INVALID_PAYLOAD: 0x0002,
  BUSY: 0x0003,
  UNAUTHORIZED: 0x0004,
  NOT_SUPPORTED: 0x0005,
  INTERNAL_ERROR: 0x0006,
  CRC_ERROR: 0x0007,
  VERSION_INCOMPATIBLE: 0x0008,
  LOW_BATTERY: 0x0009,
  PHYSICAL_CONFIRM_REQUIRED: 0x000A
};

module.exports = {
  deviceNamePrefix: "YT-",
  defaultDeviceName: "YT-000001",
  scanTimeout: 10000,
  connectTimeout: 8000,
  commandTimeout: 2000,
  commandRetries: 2,
  controlMinMTU: 31,
  maxPayloadLength: 18,
  sof: 0xA5,
  protocolVersion: 0x01,
  protocolMajor: 0x01,
  protocolMinor: 0x07,
  flags: {
    request: 0x00,
    response: 0x01,
    event: 0x02,
    authenticated: 0x08
  },
  capabilities: {
    battery: 1 << 0,
    socialMode: 1 << 1,
    findDevice: 1 << 2,
    buttonEvent: 1 << 3,
    chargingState: 1 << 4,
    timeSync: 1 << 5,
    sessionAuth: 1 << 6,
    ota: 1 << 7,
    audioUpload: 1 << 8,
    audioPlayback: 1 << 9,
    socialEncounter: 1 << 10,
    alertSettings: 1 << 11
  },
  UUIDS,
  COMMANDS,
  STATUS_CODES
};

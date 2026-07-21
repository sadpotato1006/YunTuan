const ble = require("../utils/ble");
const bufferUtils = require("../utils/buffer");
const config = require("../config/ble");
const bleMock = require("../mock/ble");
const diagnostics = require("./diagnostics");
const { getAdvertisedDeviceName, normalizeDeviceName } = require("../utils/ble-device-name");
const { formatTime, normalizeUuid, sameUuid, shortUuid, getStandardValueMeaning, formatCharacteristic, getServiceName, getCharacteristicName } = require("./ble-helpers");

const MAX_LOGS = 200;
const initialState = {
  adapterReady: false,
  available: false,
  discovering: false,
  connecting: false,
  connected: false,
  simulated: false,
  deviceId: "",
  deviceName: "",
  devices: [],
  services: [],
  logs: [],
  statusText: "尚未初始化蓝牙",
  errorMessage: ""
};

let state = Object.assign({}, initialState);
let subscribers = [];
let valueSubscribers = [];
let scanTimer = null;
let logSequence = 0;
let connectionAttemptGeneration = 0;
let unsubscribeDeviceFound = null;
let unsubscribeConnection = null;
let unsubscribeAdapter = null;
let unsubscribeValue = null;

function getState() {
  return Object.assign({}, state, {
    devices: state.devices.slice(),
    logs: state.logs.slice(),
    services: state.services.map(service => Object.assign({}, service, {
      characteristics: service.characteristics.map(item => Object.assign({}, item))
    }))
  });
}

function notifySubscribers() {
  const snapshot = getState();
  subscribers.slice().forEach(listener => listener(snapshot));
}

function setState(patch) {
  state = Object.assign({}, state, patch);
  notifySubscribers();
}

function addLog(level, message, detail) {
  const now = new Date();
  const log = {
    id: `${now.getTime()}-${logSequence += 1}`,
    time: formatTime(now),
    level,
    message,
    detail: detail || ""
  };
  state = Object.assign({}, state, { logs: [log].concat(state.logs).slice(0, MAX_LOGS) });
  if (level !== "RX" && level !== "TX") {
    diagnostics.record("ble", String(level || "info").toLowerCase(), {
      summary: String(message || "").slice(0, 120),
      connected: state.connected,
      simulated: state.simulated
    }, level === "WARN" ? "warn" : (level === "ERROR" ? "error" : "info"));
  }
  notifySubscribers();
  return log;
}


function clearLogs() {
  setState({ logs: [] });
}

function getLogText() {
  if (!state.logs.length) return "暂无蓝牙日志";
  return state.logs.slice().reverse().map(log => {
    const detail = log.detail ? ` | ${log.detail}` : "";
    return `${log.time} [${log.level}] ${log.message}${detail}`;
  }).join("\n");
}

function subscribe(listener) {
  if (typeof listener !== "function") throw new Error("蓝牙状态监听器必须是函数");
  subscribers.push(listener);
  listener(getState());
  return function unsubscribe() {
    subscribers = subscribers.filter(item => item !== listener);
  };
}

function subscribeValues(listener) {
  if (typeof listener !== "function") throw new Error("蓝牙数据监听器必须是函数");
  valueSubscribers.push(listener);
  return function unsubscribe() {
    valueSubscribers = valueSubscribers.filter(item => item !== listener);
  };
}

async function initialize() {
  if (state.adapterReady) {
    // 联调页退出时会注销监听；再次进入时即使适配器仍开启，也要重新注册。
    registerGlobalListeners();
    return getState();
  }

  setState({ statusText: "正在初始化蓝牙…", errorMessage: "" });
  addLog("INFO", "开始初始化蓝牙适配器");
  try {
    await ble.openAdapter();
    const adapterState = await ble.getAdapterState();
    registerGlobalListeners();
    setState({
      adapterReady: true,
      available: Boolean(adapterState.available),
      discovering: Boolean(adapterState.discovering),
      statusText: adapterState.available ? "蓝牙已就绪" : "请先打开手机蓝牙"
    });
    addLog("INFO", adapterState.available ? "蓝牙适配器初始化成功" : "蓝牙当前不可用");
    return getState();
  } catch (error) {
    setState({ statusText: "蓝牙初始化失败", errorMessage: error.message });
    addLog("ERROR", "蓝牙初始化失败", error.message);
    throw error;
  }
}

async function loadSimulator() {
  if (state.discovering) await stopScan();
  if (state.connected && !state.simulated) await disconnectDevice();

  const device = {
    deviceId: "YUNTUAN-SIMULATOR",
    name: "云团模拟 BLE 挂件",
    localName: "YT-SIMULATOR",
    RSSI: -35
  };
  setState({
    simulated: true,
    connected: true,
    connecting: false,
    deviceId: device.deviceId,
    deviceName: device.name,
    devices: [device],
    services: bleMock.createServices(),
    statusText: "模拟 BLE 设备已连接",
    errorMessage: ""
  });
  addLog("SIM", "已加载云团模拟 BLE 设备", "无需真实硬件");
  return getState();
}

function registerGlobalListeners() {
  if (!unsubscribeDeviceFound) unsubscribeDeviceFound = ble.onDeviceFound(handleDeviceFound);
  if (!unsubscribeConnection) unsubscribeConnection = ble.onConnectionStateChange(handleConnectionChange);
  if (!unsubscribeAdapter) unsubscribeAdapter = ble.onAdapterStateChange(handleAdapterChange);
  if (!unsubscribeValue) unsubscribeValue = ble.onValueChange(handleValueChange);
}

function handleDeviceFound(result) {
  const found = result && Array.isArray(result.devices) ? result.devices : [];
  if (!found.length) return;

  const map = {};
  state.devices.forEach(device => { map[device.deviceId] = device; });
  found.forEach(device => {
    if (!device || !device.deviceId) return;
    const isNew = !map[device.deviceId];
    const old = map[device.deviceId] || {};
    const normalized = normalizeDevice(Object.assign({}, old, device));
    map[device.deviceId] = normalized;
    if (isNew) addLog("SCAN", `发现设备：${normalized.name}`, `${normalized.deviceId} | ${normalized.RSSI} dBm`);
  });

  const devices = Object.keys(map)
    .map(id => map[id])
    .sort((a, b) => b.RSSI - a.RSSI);
  setState({ devices });
}

function normalizeDevice(device) {
  const name = getAdvertisedDeviceName(device, "未命名设备");
  return {
    deviceId: device.deviceId,
    name,
    localName: device.localName || "",
    RSSI: typeof device.RSSI === "number" ? device.RSSI : -999,
    advertisData: device.advertisData,
    serviceData: device.serviceData
  };
}

function handleConnectionChange(result) {
  if (!result || result.deviceId !== state.deviceId) return;
  if (!result.connected) {
    setState({ connected: false, connecting: false, services: [], statusText: "设备连接已断开" });
    addLog("WARN", "设备连接意外断开", result.deviceId);
  }
}

function handleAdapterChange(result) {
  if (!result) return;
  const available = Boolean(result.available);
  setState({
    available,
    discovering: Boolean(result.discovering),
    statusText: available ? state.statusText : "手机蓝牙已关闭",
    connected: available ? state.connected : false,
    connecting: available ? state.connecting : false
  });
  addLog(available ? "INFO" : "WARN", available ? "手机蓝牙已开启" : "手机蓝牙已关闭");
}

function handleValueChange(result) {
  if (!result || result.deviceId !== state.deviceId || !result.value) return;

  // 音频分片频率高，不能逐包转十六进制、写调试日志并触发整页状态刷新。
  // 音频 service 会自行做序号、进度和 CRC 校验。
  if (sameUuid(result.characteristicId, config.UUIDS.audioData)) {
    valueSubscribers.slice().forEach(listener => {
      try {
        listener(result);
      } catch (error) {
        addLog("ERROR", "上层音频数据处理失败", error.message);
      }
    });
    return;
  }

  const hex = bufferUtils.arrayBufferToHex(result.value);
  const text = bufferUtils.toPrintableText(result.value);
  const meaning = getStandardValueMeaning(result.characteristicId, result.value);
  const updatedAt = formatTime(new Date());

  updateCharacteristic(result.serviceId, result.characteristicId, {
    lastValueHex: hex,
    lastValueText: text,
    valueMeaning: meaning,
    lastUpdatedAt: updatedAt
  });
  addLog("RX", `收到 ${shortUuid(result.characteristicId)} 的数据`, `${hex}${text ? ` | UTF-8: ${text}` : ""}`);
  valueSubscribers.slice().forEach(listener => {
    try {
      listener(Object.assign({}, result, { hex, text, meaning, updatedAt }));
    } catch (error) {
      addLog("ERROR", "上层蓝牙数据处理失败", error.message);
    }
  });
}


async function startScan(options) {
  const scanOptions = options || {};
  await initialize();
  if (!state.available) throw new Error("请先打开手机蓝牙");

  if (state.discovering) await stopScan();
  clearScanTimer();
  setState({
    devices: scanOptions.keepPrevious ? state.devices : [],
    discovering: true,
    statusText: "正在搜索附近的蓝牙设备…",
    errorMessage: ""
  });
  addLog("SCAN", "开始搜索附近 BLE 设备");

  try {
    await ble.startDiscovery({
      services: Array.isArray(scanOptions.services) ? scanOptions.services : [],
      allowDuplicatesKey: true,
      interval: 500
    });
    const timeout = scanOptions.timeout || config.scanTimeout;
    scanTimer = setTimeout(() => { stopScan().catch(() => {}); }, timeout);
    return getState();
  } catch (error) {
    setState({ discovering: false, statusText: "搜索设备失败", errorMessage: error.message });
    addLog("ERROR", "搜索设备失败", error.message);
    throw error;
  }
}

async function stopScan() {
  clearScanTimer();
  if (!state.adapterReady || !state.discovering) return getState();
  try {
    await ble.stopDiscovery();
  } finally {
    setState({
      discovering: false,
      statusText: state.devices.length ? `已发现 ${state.devices.length} 台设备` : "没有发现附近设备"
    });
    addLog("SCAN", "停止搜索", `共发现 ${state.devices.length} 台设备`);
  }
  return getState();
}

function getDisplayDevices(onlyYuntuan) {
  if (!onlyYuntuan) return state.devices.slice();
  return state.devices.filter(device => device.name.startsWith(config.deviceNamePrefix));
}

async function connectDevice(deviceId, rememberedDeviceName) {
  if (!deviceId) throw new Error("请选择要连接的设备");
  await initialize();
  if (state.discovering) await stopScan();
  if (state.connected && state.deviceId === deviceId) return getState();
  if (state.connected && state.deviceId !== deviceId) await disconnectDevice();
  const attemptGeneration = connectionAttemptGeneration += 1;

  const selected = state.devices.find(device => device.deviceId === deviceId);
  const rememberedName = normalizeDeviceName(
    rememberedDeviceName,
    deviceId,
    config.defaultDeviceName
  );
  const deviceName = selected
    ? getAdvertisedDeviceName(selected, rememberedName)
    : rememberedName;
  setState({
    connecting: true,
    connected: false,
    deviceId,
    deviceName,
    services: [],
    statusText: "正在连接设备…",
    errorMessage: ""
  });
  addLog("CONNECT", `开始连接：${deviceName}`, deviceId);

  try {
    await ble.connect(deviceId, config.connectTimeout);
    assertConnectionAttempt(attemptGeneration);
    setState({ statusText: "连接成功，正在读取服务…" });
    addLog("CONNECT", "BLE 连接成功，开始发现服务");

    const serviceResult = await ble.getServices(deviceId);
    assertConnectionAttempt(attemptGeneration);
    const rawServices = Array.isArray(serviceResult.services) ? serviceResult.services : [];
    const services = [];

    for (let index = 0; index < rawServices.length; index += 1) {
      const rawService = rawServices[index];
      let characteristics = [];
      let errorMessage = "";
      try {
        const result = await ble.getCharacteristics(deviceId, rawService.uuid);
        assertConnectionAttempt(attemptGeneration);
        characteristics = (result.characteristics || []).map(formatCharacteristic);
        addLog("GATT", `发现服务：${getServiceName(rawService.uuid)}`, `${rawService.uuid} | ${characteristics.length} 个特征值`);
      } catch (error) {
        if ((error && error.cancelled) || attemptGeneration !== connectionAttemptGeneration) {
          throw createConnectionCancelledError();
        }
        errorMessage = error.message;
        addLog("ERROR", `读取服务特征值失败：${shortUuid(rawService.uuid)}`, error.message);
      }
      services.push({
        uuid: rawService.uuid,
        displayName: getServiceName(rawService.uuid),
        isPrimary: Boolean(rawService.isPrimary),
        characteristics,
        errorMessage
      });
    }

    assertConnectionAttempt(attemptGeneration);
    setState({ connecting: false, connected: true, services, statusText: `连接成功，发现 ${services.length} 个服务` });
    addLog("CONNECT", "GATT 服务发现完成", `${services.length} 个服务`);
    return getState();
  } catch (error) {
    if ((error && error.cancelled) || attemptGeneration !== connectionAttemptGeneration) {
      // Android 可能在第一次 closeBLEConnection 调用后才完成旧的
      // createBLEConnection。若此时没有新连接在进行，再补一次关闭，
      // 避免已经取消的连接在后台复活。
      if (!state.connecting && !state.connected && !state.simulated) {
        try { await ble.disconnect(deviceId); } catch (ignore) {}
      }
      throw createConnectionCancelledError();
    }
    try { await ble.disconnect(deviceId); } catch (ignore) {}
    setState({ connecting: false, connected: false, services: [], statusText: "设备连接失败", errorMessage: error.message });
    addLog("ERROR", "设备连接失败", error.message);
    throw error;
  }
}


async function readCharacteristic(serviceId, characteristicId) {
  requireConnected();
  const characteristic = findCharacteristic(serviceId, characteristicId);
  if (!characteristic || !characteristic.canRead) throw new Error("这个特征值不支持读取");
  addLog("READ", `请求读取 ${shortUuid(characteristicId)}`, serviceId);
  try {
    if (state.simulated) {
      const value = bleMock.readValue(characteristicId);
      setTimeout(() => handleValueChange({ deviceId: state.deviceId, serviceId, characteristicId, value }), 250);
      return;
    }
    await ble.readValue({ deviceId: state.deviceId, serviceId, characteristicId });
  } catch (error) {
    addLog("ERROR", `读取 ${shortUuid(characteristicId)} 失败`, error.message);
    throw error;
  }
}

async function setCharacteristicNotify(serviceId, characteristicId, enabled) {
  requireConnected();
  const characteristic = findCharacteristic(serviceId, characteristicId);
  if (!characteristic || !characteristic.canNotify) throw new Error("这个特征值不支持通知");
  const type = characteristic.properties.notify ? "notification" : "indication";
  try {
    if (state.simulated) {
      updateCharacteristic(serviceId, characteristicId, { subscribed: enabled });
      if (enabled) {
        const value = bleMock.createNotifyValue(characteristicId);
        setTimeout(() => handleValueChange({ deviceId: state.deviceId, serviceId, characteristicId, value }), 350);
      }
    } else if (enabled) {
      await ble.enableNotify({ deviceId: state.deviceId, serviceId, characteristicId, type });
    } else {
      await ble.disableNotify({ deviceId: state.deviceId, serviceId, characteristicId, type });
    }
    if (!state.simulated) updateCharacteristic(serviceId, characteristicId, { subscribed: enabled });
    addLog("NOTIFY", `${enabled ? "已订阅" : "已取消订阅"} ${shortUuid(characteristicId)}`, type);
  } catch (error) {
    addLog("ERROR", `${enabled ? "订阅" : "取消订阅"}失败`, error.message);
    throw error;
  }
}

async function writeCharacteristic(serviceId, characteristicId, hexInput, writeType) {
  const value = bufferUtils.hexToArrayBuffer(hexInput);
  return writeBuffer(serviceId, characteristicId, value, writeType);
}

async function writeBuffer(serviceId, characteristicId, value, writeType, options) {
  requireConnected();
  const writeOptions = options || {};
  const characteristic = findCharacteristic(serviceId, characteristicId);
  if (!characteristic || !characteristic.canWrite) throw new Error("这个特征值不支持写入");

  const selectedType = writeType || (characteristic.properties.write ? "write" : "writeNoResponse");
  if (selectedType === "write" && !characteristic.properties.write) throw new Error("这个特征值不支持 Write");
  if (selectedType === "writeNoResponse" && !characteristic.properties.writeNoResponse) {
    throw new Error("这个特征值不支持 WriteNoResponse");
  }

  const bytes = bufferUtils.toUint8Array(value);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (!writeOptions.quiet) {
    const hex = bufferUtils.arrayBufferToHex(value);
    addLog("TX", `向 ${shortUuid(characteristicId)} 写入数据`, `${hex} | ${selectedType}`);
  }
  try {
    if (state.simulated) {
      const response = bleMock.createWriteResponse(buffer);
      if (!writeOptions.quiet) addLog("WRITE", "模拟 BLE 写入成功", shortUuid(characteristicId));
      setTimeout(() => handleValueChange({
        deviceId: state.deviceId,
        serviceId: response.serviceId,
        characteristicId: response.characteristicId,
        value: response.value
      }), 350);
      return;
    }
    await ble.writeValue({
      deviceId: state.deviceId,
      serviceId,
      characteristicId,
      value: buffer,
      writeType: selectedType
    });
    if (!writeOptions.quiet) addLog("WRITE", "微信 BLE 写入接口返回成功", shortUuid(characteristicId));
  } catch (error) {
    addLog("ERROR", `写入 ${shortUuid(characteristicId)} 失败`, error.message);
    throw error;
  }
}

async function negotiateMTU(preferredMTU, writeType) {
  requireConnected();
  if (state.simulated) return 247;

  const requested = Number.isInteger(preferredMTU) ? preferredMTU : 247;
  const selectedWriteType = writeType === "writeNoResponse" ? "writeNoResponse" : "write";
  try {
    await ble.setMTU(state.deviceId, requested);
    addLog("MTU", "已请求协商 BLE MTU", String(requested));
  } catch (error) {
    // iOS 由系统决定 MTU；部分旧版微信也没有 setBLEMTU，继续读取实际值即可。
    addLog("MTU", "当前系统未主动设置 MTU", error.message);
  }

  try {
    const result = await ble.getMTU(state.deviceId, selectedWriteType);
    const mtu = result && Number.isInteger(result.mtu) ? result.mtu : 23;
    addLog("MTU", "当前 BLE MTU", `${mtu} | ${selectedWriteType}`);
    console.info("[BLE_MTU] 当前协商结果", {
      requested,
      actual: mtu,
      writeType: selectedWriteType
    });
    if (mtu < 100) {
      console.warn("[BLE_MTU] 当前 MTU 较低，语音传输会明显变慢", {
        actual: mtu,
        writeType: selectedWriteType
      });
    }
    return mtu;
  } catch (error) {
    addLog("MTU", "无法读取 MTU，按最小值兼容", error.message);
    return 23;
  }
}

function emitSimulatorSocialEncounter(peerToken, rssi) {
  requireConnected();
  if (!state.simulated) throw new Error("只有模拟挂件可以手动注入相遇事件");
  const value = bleMock.createSocialEncounterValue(peerToken, rssi);
  addLog("SIM", "模拟遇见另一台云团挂件", `Token ${peerToken} | ${rssi || -55} dBm`);
  handleValueChange({
    deviceId: state.deviceId,
    serviceId: config.UUIDS.controlService,
    characteristicId: config.UUIDS.eventTx,
    value
  });
  return getState();
}

function requireConnected() {
  if (!state.connected || !state.deviceId) throw new Error("请先连接 BLE 设备");
}

function findCharacteristic(serviceId, characteristicId) {
  const service = state.services.find(item => sameUuid(item.uuid, serviceId));
  if (!service) return null;
  return service.characteristics.find(item => sameUuid(item.uuid, characteristicId)) || null;
}

function updateCharacteristic(serviceId, characteristicId, patch) {
  const services = state.services.map(service => {
    if (!sameUuid(service.uuid, serviceId)) return service;
    return Object.assign({}, service, {
      characteristics: service.characteristics.map(characteristic =>
        sameUuid(characteristic.uuid, characteristicId)
          ? Object.assign({}, characteristic, patch)
          : characteristic
      )
    });
  });
  setState({ services });
}

async function disconnectDevice() {
  clearScanTimer();
  connectionAttemptGeneration += 1;
  const deviceId = state.deviceId;
  if (!deviceId || (!state.connected && !state.connecting)) {
    setState({ connected: false, connecting: false, services: [], statusText: "设备未连接" });
    return getState();
  }
  addLog("CONNECT", "主动断开设备", deviceId);
  if (state.simulated) {
    setState({
      simulated: false,
      connecting: false,
      connected: false,
      deviceId: "",
      deviceName: "",
      services: [],
      statusText: "模拟设备已断开"
    });
    addLog("SIM", "模拟 BLE 设备已断开");
    return getState();
  }
  try {
    await ble.disconnect(deviceId);
  } finally {
    setState({ connecting: false, connected: false, services: [], statusText: "设备已断开" });
    addLog("CONNECT", "设备已断开");
  }
  return getState();
}

function assertConnectionAttempt(attemptGeneration) {
  if (attemptGeneration === connectionAttemptGeneration) return;
  throw createConnectionCancelledError();
}

function createConnectionCancelledError() {
  const error = new Error("已停止重新连接");
  error.cancelled = true;
  return error;
}

async function dispose(options) {
  const disposeOptions = options || {};
  clearScanTimer();
  try { await stopScan(); } catch (ignore) {}
  if (disposeOptions.disconnect) {
    try { await disconnectDevice(); } catch (ignore) {}
  }
  if (unsubscribeDeviceFound) unsubscribeDeviceFound();
  if (unsubscribeConnection) unsubscribeConnection();
  if (unsubscribeAdapter) unsubscribeAdapter();
  if (unsubscribeValue) unsubscribeValue();
  unsubscribeDeviceFound = null;
  unsubscribeConnection = null;
  unsubscribeAdapter = null;
  unsubscribeValue = null;
  if (disposeOptions.closeAdapter) {
    try { await ble.closeAdapter(); } catch (ignore) {}
    const logs = state.logs;
    state = Object.assign({}, initialState, { logs });
  }
}

function clearScanTimer() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
}

module.exports = {
  initialize,
  loadSimulator,
  startScan,
  stopScan,
  getDisplayDevices,
  connectDevice,
  disconnectDevice,
  readCharacteristic,
  setCharacteristicNotify,
  writeCharacteristic,
  writeBuffer,
  negotiateMTU,
  emitSimulatorSocialEncounter,
  getState,
  subscribe,
  subscribeValues,
  clearLogs,
  getLogText,
  dispose
};

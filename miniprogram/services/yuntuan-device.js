const bleService = require("./ble");
const audioService = require("./yuntuan-audio");
const ttsService = require("./yuntuan-tts");
const socialService = require("./social");
const config = require("../config/ble");
const protocol = require("../utils/yuntuan-protocol");
const bufferUtils = require("../utils/buffer");

const RECONNECT_DELAYS = [1000, 3000, 5000, 10000, 15000, 30000];
const LAST_DEVICE_STORAGE_KEY = "yuntuan_last_ble_device";
const initialState = {
  initialized: false,
  available: false,
  discovering: false,
  connecting: false,
  connected: false,
  ready: false,
  simulated: false,
  canReconnect: false,
  rememberedDeviceName: "",
  deviceId: "",
  name: "云团智能挂件",
  devices: [],
  battery: null,
  chargingState: 255,
  socialMode: false,
  uptime: 0,
  protocolMajor: null,
  protocolMinor: null,
  capabilities: 0,
  securityMode: null,
  bindState: 0,
  modelNumber: "",
  firmwareRevision: "",
  hardwareRevision: "",
  serialNumber: "",
  statusText: "设备未连接",
  errorMessage: "",
  lastEventText: "",
  lastEncounterAt: 0,
  lastEncounterText: "",
  lastEncounterRssi: null,
  encounterCount: 0,
  ownSocialToken: 0,
  lastEncounterProfile: null,
  encounterProfileLoading: false,
  encounterProfileMessage: ""
};

let state = Object.assign({}, initialState);
let subscribers = [];
let sequence = 0;
let pendingRequest = null;
let valueWaiters = [];
let intentionalDisconnect = false;
let lastDeviceId = "";
let lastDeviceName = "";
let rememberedDeviceLoaded = false;
let startupReconnectAttempted = false;
let reconnectIndex = 0;
let reconnectTimer = null;
let wasConnected = false;
let encounterResolveVersion = 0;

bleService.subscribe(handleTransportState);
bleService.subscribeValues(handleValue);

function getState() {
  return Object.assign({}, state, {
    devices: state.devices.map(item => Object.assign({}, item))
  });
}

function setState(patch) {
  state = Object.assign({}, state, patch);
  const snapshot = getState();
  subscribers.slice().forEach(listener => listener(snapshot));
}

function subscribe(listener) {
  if (typeof listener !== "function") throw new Error("设备状态监听器必须是函数");
  subscribers.push(listener);
  listener(getState());
  return function unsubscribe() {
    subscribers = subscribers.filter(item => item !== listener);
  };
}

function handleTransportState(transport) {
  const connected = Boolean(transport.connected);
  setState({
    initialized: Boolean(transport.adapterReady),
    available: Boolean(transport.available),
    discovering: Boolean(transport.discovering),
    connecting: Boolean(transport.connecting),
    connected,
    simulated: Boolean(transport.simulated),
    deviceId: transport.deviceId || state.deviceId,
    name: transport.deviceName || state.name,
    devices: (transport.devices || []).filter(device =>
      String(device.name || device.localName || "").startsWith(config.deviceNamePrefix)
    ),
    statusText: state.ready && connected ? "设备已就绪" : transport.statusText,
    errorMessage: transport.errorMessage || ""
  });

  if (wasConnected && !connected) handleUnexpectedDisconnect();
  wasConnected = connected;
}

function handleUnexpectedDisconnect() {
  rejectPending(new Error("设备连接已断开"));
  rejectValueWaiters(new Error("设备连接已断开"));
  setState({ ready: false, statusText: "设备连接已断开" });
  if (!intentionalDisconnect && lastDeviceId && !state.simulated) scheduleReconnect();
}

function handleValue(result) {
  resolveValueWaiters(result);
  if (sameUuid(result.characteristicId, config.UUIDS.batteryLevel)) {
    const bytes = protocol.toBytes(result.value);
    if (bytes.length === 1 && bytes[0] <= 100) setState({ battery: bytes[0] });
    return;
  }
  if (!sameUuid(result.characteristicId, config.UUIDS.eventTx)) return;

  let frame;
  try {
    frame = protocol.decodeFrame(result.value);
  } catch (error) {
    setState({ errorMessage: error.message });
    return;
  }

  if (frame.isResponse) {
    if (!pendingRequest) return;
    if (frame.sequence !== pendingRequest.sequence || frame.command !== pendingRequest.command) return;
    const pending = pendingRequest;
    pendingRequest = null;
    clearTimeout(pending.timer);
    pending.resolve(frame);
    return;
  }

  if (!frame.isEvent) return;
  try {
    applyEvent(protocol.parseEvent(frame));
  } catch (error) {
    setState({ errorMessage: error.message });
  }
}

function applyEvent(event) {
  if (event.type === "statusChanged") {
    setState({
      battery: event.battery,
      chargingState: event.chargingState,
      socialMode: event.socialMode,
      lastEventText: "设备状态已更新"
    });
    return;
  }
  if (event.type === "button") {
    const labels = { 1: "单击", 2: "双击", 3: "长按" };
    setState({ lastEventText: `收到挂件${labels[event.buttonType]}事件` });
    return;
  }
  if (event.type === "lowBattery") {
    setState({ battery: event.battery, lastEventText: `设备低电量：${event.battery}%` });
    return;
  }
  if (event.type === "bindWindowChanged") {
    setState({ bindState: event.bindState, lastEventText: "设备绑定状态已变化" });
    return;
  }
  if (event.type === "socialEncounter") {
    const encounteredAt = Date.now() - event.ageSeconds * 1000;
    const resolveVersion = ++encounterResolveVersion;
    setState({
      lastEncounterAt: encounteredAt,
      lastEncounterText: formatEncounterTime(encounteredAt),
      lastEncounterRssi: event.rssi,
      encounterCount: state.encounterCount + 1,
      lastEventText: "附近遇到了一位云团伙伴",
      lastEncounterProfile: null,
      encounterProfileLoading: true,
      encounterProfileMessage: "正在获取对方的公开名片…"
    });
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "遇到云团伙伴啦", icon: "none", duration: 2200 });
    }
    socialService.resolveToken(event.peerToken)
      .then(profile => {
        if (resolveVersion !== encounterResolveVersion) return;
        setState({
          lastEncounterProfile: profile,
          encounterProfileLoading: false,
          encounterProfileMessage: profile ? "" : "对方暂未公开社交名片"
        });
      })
      .catch(error => {
        if (resolveVersion !== encounterResolveVersion) return;
        setState({
          encounterProfileLoading: false,
          encounterProfileMessage: error.message || "对方名片暂时无法获取"
        });
      });
  }
}

function formatEncounterTime(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function initialize() {
  loadRememberedDevice();
  await bleService.initialize();
  if (!startupReconnectAttempted && lastDeviceId && !state.connected && !state.connecting) {
    startupReconnectAttempted = true;
    reconnectLastDevice(true).catch(() => {});
  }
  return result({ device: toDevice(), devices: getDisplayDevices() });
}

async function startScan() {
  intentionalDisconnect = false;
  await bleService.startScan({ services: [config.UUIDS.controlService] });
  return result({ devices: getDisplayDevices() });
}

async function stopScan() {
  await bleService.stopScan();
  return result({ devices: getDisplayDevices() });
}

function getDisplayDevices() {
  return bleService.getDisplayDevices(true);
}

async function connectDevice(deviceId) {
  if (!deviceId) throw new Error("请选择要连接的云团挂件");
  cancelReconnect();
  intentionalDisconnect = false;
  setState({ connecting: true, ready: false, errorMessage: "", statusText: "正在连接挂件…" });
  try {
    await bleService.connectDevice(deviceId);
    await initializeConnectedDevice();
    const transport = bleService.getState();
    if (!transport.simulated) rememberDevice(deviceId, transport.deviceName || state.name);
    reconnectIndex = 0;
    return result({ device: toDevice() });
  } catch (error) {
    intentionalDisconnect = true;
    try { await bleService.disconnectDevice(); } catch (ignore) {}
    setState({ connecting: false, ready: false, errorMessage: error.message, statusText: "设备初始化失败" });
    throw error;
  }
}

async function loadSimulator() {
  cancelReconnect();
  intentionalDisconnect = false;
  await bleService.loadSimulator();
  await initializeConnectedDevice();
  return result({ device: toDevice() });
}

async function initializeConnectedDevice() {
  const transport = bleService.getState();
  assertRequiredGatt(transport.services);

  await bleService.setCharacteristicNotify(
    config.UUIDS.controlService,
    config.UUIDS.eventTx,
    true
  );

  if (findCharacteristic(transport.services, config.UUIDS.batteryService, config.UUIDS.batteryLevel)) {
    await bleService.setCharacteristicNotify(
      config.UUIDS.batteryService,
      config.UUIDS.batteryLevel,
      true
    );
  }

  const infoResult = await readCharacteristicValue(config.UUIDS.controlService, config.UUIDS.protocolInfo);
  const info = protocol.parseProtocolInfo(infoResult.value);
  validateProtocolInfo(info);
  setState(info);

  if (protocol.hasCapability(info.capabilities, config.capabilities.audioUpload)) {
    const audioAttached = await audioService.attach(transport.services);
    if (!audioAttached) throw new Error("设备声明支持语音，但缺少 Audio Transfer Service");
  }

  if (protocol.hasCapability(info.capabilities, config.capabilities.audioPlayback)) {
    const ttsAttached = await ttsService.attach(transport.services);
    if (!ttsAttached) throw new Error("设备声明支持朗读，但缺少 Speech Playback Service");
  }

  await readStandardDeviceInformation(transport.services);

  const helloResponse = await request(config.COMMANDS.HELLO);
  const hello = protocol.parseHelloData(helloResponse.data);
  validateProtocolInfo(hello);
  setState(hello);

  await getStatus();
  if (protocol.hasCapability(info.capabilities, config.capabilities.socialEncounter)) {
    const tokenResponse = await request(config.COMMANDS.GET_SOCIAL_TOKEN);
    if (tokenResponse.data.length !== 4) throw new Error("挂件匿名令牌长度不正确");
    setState({ ownSocialToken: protocol.readUint32LE(tokenResponse.data, 0) });
  }
  setState({ connecting: false, connected: true, ready: true, statusText: "设备已就绪", errorMessage: "" });
  refreshSocialRegistration().catch(error => {
    console.warn("社交匿名令牌登记失败：", error && error.message);
  });
}

async function refreshSocialRegistration() {
  if (!state.connected || !state.ownSocialToken) return { registered: false };
  const result = await socialService.registerToken(state.ownSocialToken);
  return Object.assign({ registered: true }, result);
}

async function readStandardDeviceInformation(services) {
  const fields = [
    [config.UUIDS.modelNumber, "modelNumber"],
    [config.UUIDS.firmwareRevision, "firmwareRevision"],
    [config.UUIDS.hardwareRevision, "hardwareRevision"]
  ];
  const patch = {};
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const value = await readCharacteristicValue(config.UUIDS.deviceInfoService, field[0]);
    patch[field[1]] = bufferUtils.arrayBufferToUtf8(value.value);
  }

  if (findCharacteristic(services, config.UUIDS.deviceInfoService, config.UUIDS.serialNumber)) {
    const value = await readCharacteristicValue(config.UUIDS.deviceInfoService, config.UUIDS.serialNumber);
    patch.serialNumber = bufferUtils.arrayBufferToUtf8(value.value);
  }

  const batteryValue = await readCharacteristicValue(config.UUIDS.batteryService, config.UUIDS.batteryLevel);
  const batteryBytes = protocol.toBytes(batteryValue.value);
  if (batteryBytes.length !== 1 || batteryBytes[0] > 100) throw new Error("标准电量特征值格式不正确");
  patch.battery = batteryBytes[0];
  setState(patch);
}

function validateProtocolInfo(info) {
  if (info.protocolMajor !== config.protocolMajor) {
    throw new Error(`设备协议主版本 ${info.protocolMajor} 与小程序版本 ${config.protocolMajor} 不兼容`);
  }
  if (info.protocolMinor < config.protocolMinor) {
    throw new Error(
      `设备协议版本 ${info.protocolMajor}.${info.protocolMinor} 过低，小程序至少需要 ${config.protocolMajor}.${config.protocolMinor}`
    );
  }
  if (info.reserved !== undefined && info.reserved !== 0) throw new Error("Protocol Info 保留字节必须为 0");
}

async function getStatus() {
  const response = await request(config.COMMANDS.GET_STATUS);
  const status = protocol.parseStatusData(response.data);
  setState(status);
  return result({ device: toDevice() });
}

async function setSocialMode(enabled) {
  requireReady();
  const response = await request(
    config.COMMANDS.SET_SOCIAL_MODE,
    protocol.buildSetSocialModePayload(Boolean(enabled))
  );
  const status = protocol.parseSocialModeData(response.data);
  setState(status);
  return result({ device: toDevice() });
}

async function findDevice(alertType, duration) {
  requireReady();
  if (!protocol.hasCapability(state.capabilities, config.capabilities.findDevice)) {
    throw new Error("当前挂件不支持查找提醒");
  }
  await request(
    config.COMMANDS.FIND_DEVICE,
    protocol.buildFindDevicePayload(alertType === undefined ? 0 : alertType, duration || 1500),
    { timeout: 3000, retries: 1 }
  );
  setState({ lastEventText: "挂件正在震动、响铃并闪灯" });
  return result({ device: toDevice() });
}

async function setTime(unixTime) {
  requireReady();
  const value = unixTime === undefined ? Math.floor(Date.now() / 1000) : unixTime;
  await request(config.COMMANDS.SET_TIME, protocol.buildUint32Payload(value));
  return result({ device: toDevice() });
}

async function ping(randomValue) {
  requireReady();
  const value = randomValue === undefined ? Math.floor(Math.random() * 0xFFFFFFFF) : randomValue;
  const payload = protocol.buildUint32Payload(value);
  const response = await request(config.COMMANDS.PING, payload);
  if (response.data.length !== 4 || protocol.readUint32LE(response.data, 0) !== value) {
    throw new Error("设备 PING 响应与请求不一致");
  }
  return result({ latencyVerified: true });
}

async function request(command, payload, options) {
  if (pendingRequest) throw new Error("上一条设备命令尚未完成");
  if (!bleService.getState().connected) throw new Error("设备尚未连接");
  const requestOptions = options || {};
  const requestSequence = nextSequence();
  const frame = protocol.createRequest(command, requestSequence, payload, state.securityMode === 1);
  const retries = requestOptions.retries === undefined ? config.commandRetries : requestOptions.retries;
  const timeout = requestOptions.timeout || config.commandTimeout;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const responseFrame = await sendAndWait(frame, command, requestSequence, timeout);
      return protocol.assertSuccessfulResponse(responseFrame);
    } catch (error) {
      lastError = error;
      if (error.statusCode !== undefined || !bleService.getState().connected) break;
    }
  }
  throw lastError || new Error("设备命令执行失败");
}

function sendAndWait(frame, command, requestSequence, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequest && pendingRequest.sequence === requestSequence) pendingRequest = null;
      reject(new Error("等待设备响应超时"));
    }, timeout);
    pendingRequest = { command, sequence: requestSequence, resolve, reject, timer };
    bleService.writeBuffer(
      config.UUIDS.controlService,
      config.UUIDS.commandRx,
      frame,
      "write"
    ).catch(error => {
      if (pendingRequest && pendingRequest.sequence === requestSequence) pendingRequest = null;
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function disconnectDevice() {
  const wasSimulated = state.simulated;
  intentionalDisconnect = true;
  cancelReconnect();
  rejectPending(new Error("设备已主动断开"));
  rejectValueWaiters(new Error("设备已主动断开"));
  await bleService.disconnectDevice();
  if (!wasSimulated) forgetRememberedDevice();
  resetConnectionState("设备已断开");
  if (wasSimulated && lastDeviceId) {
    setState({ canReconnect: true, rememberedDeviceName: lastDeviceName });
  }
  return result({ device: toDevice() });
}

function scheduleReconnect() {
  if (reconnectTimer || reconnectIndex >= RECONNECT_DELAYS.length) {
    if (reconnectIndex >= RECONNECT_DELAYS.length) {
      setState({
        canReconnect: Boolean(lastDeviceId),
        rememberedDeviceName: lastDeviceName,
        statusText: "自动重连失败，可以点击重新连接",
        errorMessage: "设备重连失败"
      });
    }
    return;
  }
  const delay = RECONNECT_DELAYS[reconnectIndex];
  reconnectIndex += 1;
  setState({ statusText: `${delay / 1000} 秒后尝试重新连接…` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDevice(lastDeviceId).catch(() => {
      intentionalDisconnect = false;
      scheduleReconnect();
    });
  }, delay);
}

async function reconnectLastDevice(silent) {
  loadRememberedDevice();
  if (!lastDeviceId || lastDeviceId === "YUNTUAN-SIMULATOR") {
    if (silent) return result({ device: toDevice() });
    throw new Error("没有可重新连接的挂件，请先搜索设备");
  }
  if (state.connected && state.ready) return result({ device: toDevice() });
  reconnectIndex = 0;
  cancelReconnect();
  setState({
    canReconnect: true,
    rememberedDeviceName: lastDeviceName,
    statusText: `正在重新连接${lastDeviceName ? ` ${lastDeviceName}` : "上次的挂件"}…`,
    errorMessage: ""
  });
  try {
    return await connectDevice(lastDeviceId);
  } catch (error) {
    intentionalDisconnect = false;
    scheduleReconnect();
    if (silent) return result({ device: toDevice() });
    throw error;
  }
}

function loadRememberedDevice() {
  if (rememberedDeviceLoaded) return;
  rememberedDeviceLoaded = true;
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return;
  const saved = wx.getStorageSync(LAST_DEVICE_STORAGE_KEY);
  if (!saved || typeof saved !== "object" || typeof saved.deviceId !== "string") return;
  lastDeviceId = saved.deviceId;
  lastDeviceName = typeof saved.name === "string" ? saved.name : "";
  setState({ canReconnect: Boolean(lastDeviceId), rememberedDeviceName: lastDeviceName });
}

function rememberDevice(deviceId, name) {
  lastDeviceId = deviceId;
  lastDeviceName = name || "云团智能挂件";
  setState({ canReconnect: true, rememberedDeviceName: lastDeviceName });
  if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
    wx.setStorageSync(LAST_DEVICE_STORAGE_KEY, { deviceId: lastDeviceId, name: lastDeviceName });
  }
}

function forgetRememberedDevice() {
  lastDeviceId = "";
  lastDeviceName = "";
  reconnectIndex = 0;
  setState({ canReconnect: false, rememberedDeviceName: "" });
  if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
    wx.removeStorageSync(LAST_DEVICE_STORAGE_KEY);
  }
}

function cancelReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function waitForValue(characteristicId, timeout) {
  return new Promise((resolve, reject) => {
    const waiter = {
      characteristicId,
      resolve,
      reject,
      timer: setTimeout(() => {
        valueWaiters = valueWaiters.filter(item => item !== waiter);
        reject(new Error("读取设备特征值超时"));
      }, timeout)
    };
    valueWaiters.push(waiter);
  });
}

async function readCharacteristicValue(serviceId, characteristicId) {
  const valuePromise = waitForValue(characteristicId, config.commandTimeout);
  try {
    await bleService.readCharacteristic(serviceId, characteristicId);
    return await valuePromise;
  } catch (error) {
    rejectMatchingValueWaiters(characteristicId, error);
    try { await valuePromise; } catch (ignore) {}
    throw error;
  }
}

function resolveValueWaiters(result) {
  const matched = valueWaiters.filter(item => sameUuid(item.characteristicId, result.characteristicId));
  if (!matched.length) return;
  valueWaiters = valueWaiters.filter(item => !matched.includes(item));
  matched.forEach(waiter => {
    clearTimeout(waiter.timer);
    waiter.resolve(result);
  });
}

function rejectPending(error) {
  if (!pendingRequest) return;
  const pending = pendingRequest;
  pendingRequest = null;
  clearTimeout(pending.timer);
  pending.reject(error);
}

function rejectValueWaiters(error) {
  const waiters = valueWaiters;
  valueWaiters = [];
  waiters.forEach(waiter => {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  });
}

function rejectMatchingValueWaiters(characteristicId, error) {
  const matched = valueWaiters.filter(item => sameUuid(item.characteristicId, characteristicId));
  valueWaiters = valueWaiters.filter(item => !matched.includes(item));
  matched.forEach(waiter => {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  });
}

function resetConnectionState(statusText) {
  setState(Object.assign({}, initialState, {
    initialized: state.initialized,
    available: state.available,
    devices: state.devices,
    statusText
  }));
}

function assertRequiredGatt(services) {
  const required = [
    [config.UUIDS.batteryService, config.UUIDS.batteryLevel, "Battery Level"],
    [config.UUIDS.deviceInfoService, config.UUIDS.modelNumber, "Model Number"],
    [config.UUIDS.deviceInfoService, config.UUIDS.firmwareRevision, "Firmware Revision"],
    [config.UUIDS.deviceInfoService, config.UUIDS.hardwareRevision, "Hardware Revision"],
    [config.UUIDS.controlService, config.UUIDS.commandRx, "Command RX"],
    [config.UUIDS.controlService, config.UUIDS.eventTx, "Event TX"],
    [config.UUIDS.controlService, config.UUIDS.protocolInfo, "Protocol Info"]
  ];
  required.forEach(item => {
    if (!findCharacteristic(services, item[0], item[1])) throw new Error(`设备缺少必需特征值：${item[2]}`);
  });
}

function findCharacteristic(services, serviceId, characteristicId) {
  const service = (services || []).find(item => sameUuid(item.uuid, serviceId));
  if (!service) return null;
  return (service.characteristics || []).find(item => sameUuid(item.uuid, characteristicId)) || null;
}

function sameUuid(first, second) {
  return normalizeUuid(first) === normalizeUuid(second);
}

function normalizeUuid(value) {
  return String(value || "").replace(/-/g, "").toUpperCase();
}

function nextSequence() {
  sequence = sequence >= 255 ? 1 : sequence + 1;
  return sequence;
}

function requireReady() {
  if (!state.ready || !state.connected) throw new Error("设备尚未完成初始化");
}

function toDevice() {
  return {
    id: state.deviceId || "",
    name: state.name || "云团智能挂件",
    connected: state.connected,
    connecting: state.connecting,
    ready: state.ready,
    simulated: state.simulated,
    canReconnect: state.canReconnect,
    rememberedDeviceName: state.rememberedDeviceName,
    battery: state.battery,
    chargingState: state.chargingState,
    socialMode: state.socialMode,
    uptime: state.uptime,
    protocolMajor: state.protocolMajor,
    protocolMinor: state.protocolMinor,
    capabilities: state.capabilities,
    securityMode: state.securityMode,
    bindState: state.bindState,
    modelNumber: state.modelNumber,
    firmwareRevision: state.firmwareRevision,
    hardwareRevision: state.hardwareRevision,
    serialNumber: state.serialNumber,
    statusText: state.statusText,
    errorMessage: state.errorMessage,
    lastEventText: state.lastEventText,
    lastEncounterAt: state.lastEncounterAt,
    lastEncounterText: state.lastEncounterText,
    lastEncounterRssi: state.lastEncounterRssi,
    encounterCount: state.encounterCount,
    lastEncounterProfile: state.lastEncounterProfile,
    encounterProfileLoading: state.encounterProfileLoading,
    encounterProfileMessage: state.encounterProfileMessage
  };
}

function getDevice() {
  return Promise.resolve(result({ device: toDevice(), devices: getDisplayDevices() }));
}

function getHomeOverview() {
  const hour = new Date().getHours();
  const greeting = hour < 11
    ? "早上好，愿您今天心情舒畅"
    : (hour < 18 ? "下午好，记得给自己一点休息时间" : "晚上好，今天也辛苦啦");
  return Promise.resolve(result({
    greeting,
    careTip: state.connected ? "云团挂件连接正常，出门前记得查看电量。" : "云团挂件尚未连接，可以前往设备页进行连接。",
    device: toDevice()
  }));
}

function result(data) {
  return { code: 0, message: "success", data };
}

module.exports = {
  initialize,
  startScan,
  stopScan,
  getDisplayDevices,
  connectDevice,
  reconnectLastDevice,
  loadSimulator,
  disconnectDevice,
  getDevice,
  getHomeOverview,
  getStatus,
  setSocialMode,
  findDevice,
  setTime,
  ping,
  refreshSocialRegistration,
  getState,
  subscribe
};

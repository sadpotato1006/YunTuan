const bleService = require("./ble");
const audioService = require("./yuntuan-audio");
const ttsService = require("./yuntuan-tts");
const socialService = require("./social");
const encounterStore = require("./social-encounters");
const settingsService = require("./settings");
const config = require("../config/ble");
const protocol = require("../utils/yuntuan-protocol");
const bufferUtils = require("../utils/buffer");
const { normalizeDeviceName } = require("../utils/ble-device-name");
const { toDevice: buildDeviceView, homeOverview, result } = require("./yuntuan-device-view");
const { createGattHelpers } = require("./yuntuan-device-gatt");
const {
  assertRequiredGatt,
  findCharacteristic,
  sameUuid,
  validateProtocolInfo
} = createGattHelpers(config);

const RECONNECT_DELAYS = [1000, 3000, 5000, 10000, 15000, 30000];
const BATTERY_READING_TIMEOUT_MS = 6000;
const LAST_DEVICE_STORAGE_KEY = "yuntuan_last_ble_device";
const SOCIAL_REGISTRATION_REFRESH_MS = 6 * 60 * 60 * 1000;
const SOCIAL_REGISTRATION_LEEWAY_MS = 60 * 60 * 1000;
const initialState = {
  initialized: false,
  available: false,
  discovering: false,
  connecting: false,
  reconnecting: false,
  connected: false,
  ready: false,
  simulated: false,
  canReconnect: false,
  rememberedDeviceName: "",
  deviceId: "",
  name: config.defaultDeviceName,
  devices: [],
  battery: null,
  batteryStatus: "reading",
  socialMode: false,
  socialReminder: true,
  vibration: true,
  sound: false,
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
  lastEncounterId: "",
  lastEncounterText: "",
  lastEncounterTimeEstimated: false,
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
let reconnectGeneration = 0;
let connectionOperationGeneration = 0;
let wasConnected = false;
let activeEncounterResolutions = Object.create(null);
let pendingSocialAcks = [];
let socialAckInFlight = false;
let socialAckRetryTimer = null;
let registeredSocialToken = 0;
let socialRegistrationExpiresAt = 0;
let socialRegistrationPromise = null;
let socialRegistrationTimer = null;
let batteryUnavailableTimer = null;

restoreCachedEncounterState();

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

function clearBatteryUnavailableTimer() {
  if (batteryUnavailableTimer) clearTimeout(batteryUnavailableTimer);
  batteryUnavailableTimer = null;
}

function applyBatteryReading(battery, pendingWhenMissing) {
  clearBatteryUnavailableTimer();
  if (Number.isInteger(battery) && battery >= 0 && battery <= 100) {
    setState({ battery, batteryStatus: "available" });
    return;
  }
  const batteryStatus = pendingWhenMissing && state.batteryStatus !== "unavailable"
    ? "reading"
    : "unavailable";
  setState({ battery: null, batteryStatus });
  if (batteryStatus !== "reading") return;
  batteryUnavailableTimer = setTimeout(() => {
    batteryUnavailableTimer = null;
    if (state.connected && state.battery === null && state.batteryStatus === "reading") {
      setState({ batteryStatus: "unavailable" });
    }
  }, BATTERY_READING_TIMEOUT_MS);
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
  const deviceId = transport.deviceId || state.deviceId;
  setState({
    initialized: Boolean(transport.adapterReady),
    available: Boolean(transport.available),
    discovering: Boolean(transport.discovering),
    connecting: Boolean(transport.connecting),
    connected,
    simulated: Boolean(transport.simulated),
    deviceId,
    name: normalizeDeviceName(transport.deviceName, deviceId, state.name || config.defaultDeviceName),
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
  if (!intentionalDisconnect && lastDeviceId && !state.simulated) {
    reconnectIndex = 0;
    scheduleReconnect(reconnectGeneration += 1);
  }
}

function handleValue(result) {
  resolveValueWaiters(result);
  if (sameUuid(result.characteristicId, config.UUIDS.batteryLevel)) {
    const bytes = protocol.toBytes(result.value);
    if (bytes.length === 1 && bytes[0] <= 100) applyBatteryReading(bytes[0], false);
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
    scheduleSocialAckPump(0);
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
      socialMode: event.socialMode,
      lastEventText: "设备状态已更新"
    });
    applyBatteryReading(event.battery, false);
    return;
  }
  if (event.type === "button") {
    const labels = { 1: "单击", 2: "双击", 3: "长按" };
    setState({ lastEventText: `收到挂件${labels[event.buttonType]}事件` });
    return;
  }
  if (event.type === "lowBattery") {
    applyBatteryReading(event.battery, false);
    setState({ lastEventText: `设备低电量：${event.battery}%` });
    return;
  }
  if (event.type === "bindWindowChanged") {
    setState({ bindState: event.bindState, lastEventText: "设备绑定状态已变化" });
    return;
  }
  if (event.type === "socialEncounter") {
    processSocialEncounter(event);
  }
}

function processSocialEncounter(event) {
  let saved;
  try {
    saved = encounterStore.saveEncounter(event);
  } catch (error) {
    // 本地没有可靠落盘时绝不能 ACK，固件会继续保留并重发。
    setState({ errorMessage: error.message || "相遇记录保存失败" });
    return;
  }

  enqueueSocialEncounterAck(saved.record.encounterId);
  const displayRecord = encounterStore.toDisplayRecord(saved.record);
  if (!saved.record.profile && saved.record.peerToken) {
    resolveEncounterProfile(saved.record.encounterId, saved.record.peerToken, !saved.duplicate);
  }
  applyEncounterRecord(displayRecord, !saved.duplicate);
}

function notifyNewSocialEncounter() {
  const reminderSettings = settingsService.getSettings();
  if (reminderSettings.socialReminder && typeof wx !== "undefined") {
    if (reminderSettings.vibration && typeof wx.vibrateShort === "function") {
      wx.vibrateShort({ type: "light", fail() {} });
    }
    if (typeof wx.showToast === "function") {
      wx.showToast({ title: "遇到云团伙伴啦", icon: "none", duration: 2200 });
    }
  }
}

function retryLastEncounterProfile() {
  return retryEncounterProfile(state.lastEncounterId);
}

function retryEncounterProfile(encounterId) {
  const record = encounterId ? encounterStore.getRecord(encounterId) : null;
  if (!record || !record.peerToken) {
    return Promise.reject(new Error("暂无可以重新查询的相遇名片"));
  }
  if (state.lastEncounterId === record.encounterId) {
    setState({
      lastEncounterProfile: null,
      encounterProfileLoading: true,
      encounterProfileMessage: "正在重新获取对方的公开名片…"
    });
  }
  return resolveEncounterProfile(record.encounterId, record.peerToken);
}

function resolveEncounterProfile(encounterId, peerToken, notifyOnResolved) {
  if (activeEncounterResolutions[encounterId]) {
    return activeEncounterResolutions[encounterId];
  }
  const promise = socialService.resolveToken(peerToken)
    .then(resolution => {
      const updated = encounterStore.markResolved(encounterId, resolution);
      if (updated && state.lastEncounterId === encounterId) {
        applyEncounterRecord(encounterStore.toDisplayRecord(updated), false);
      }
      if (notifyOnResolved && resolution.profile && resolution.alreadyKnown !== true) {
        notifyNewSocialEncounter();
      }
      return resolution.profile;
    })
    .catch(error => {
      let updated = null;
      try {
        updated = encounterStore.markFailed(
          encounterId,
          error.message || "对方名片暂时无法获取"
        );
      } catch (storageError) {
        setState({ errorMessage: storageError.message || "相遇记录更新失败" });
      }
      if (updated && state.lastEncounterId === encounterId) {
        applyEncounterRecord(encounterStore.toDisplayRecord(updated), false);
      }
      return null;
    })
    .finally(() => {
      delete activeEncounterResolutions[encounterId];
    });
  activeEncounterResolutions[encounterId] = promise;
  return promise;
}

function getEncounterRecords() {
  return encounterStore.getDisplayRecords();
}

function clearLocalPrivateState() {
  try {
    encounterStore.clearRecords();
  } catch (error) {
    console.warn("相遇记录清理失败，将继续清空全部本地存储：", error && error.message);
  }
  if (socialRegistrationTimer) clearTimeout(socialRegistrationTimer);
  socialRegistrationTimer = null;
  registeredSocialToken = 0;
  socialRegistrationExpiresAt = 0;
  setState({
    lastEventText: "",
    lastEncounterAt: 0,
    lastEncounterId: "",
    lastEncounterText: "",
    lastEncounterTimeEstimated: false,
    lastEncounterRssi: null,
    encounterCount: 0,
    lastEncounterProfile: null,
    encounterProfileLoading: false,
    encounterProfileMessage: ""
  });
}

function applyEncounterRecord(record, isNew) {
  if (!record) return;
  const loading = record.status === "pending" &&
    Boolean(activeEncounterResolutions[record.encounterId]);
  setState({
    lastEncounterAt: record.occurredAt,
    lastEncounterId: record.encounterId,
    lastEncounterText: `${formatEncounterTime(record.occurredAt)}${record.timeEstimated ? "（约）" : ""}`,
    lastEncounterTimeEstimated: record.timeEstimated,
    lastEncounterRssi: record.rssi,
    encounterCount: encounterStore.getDisplayRecords().length,
    lastEventText: isNew ? "附近遇到了一位云团伙伴" : state.lastEventText,
    lastEncounterProfile: record.profile,
    encounterProfileLoading: loading,
    encounterProfileMessage: record.profile ? "" : (
      record.errorMessage || (loading ? "正在获取对方的公开名片…" : "可以重新获取对方名片")
    )
  });
}

function restoreCachedEncounterState() {
  try {
    const latest = encounterStore.getLatestRecord();
    if (!latest) return;
    const record = encounterStore.toDisplayRecord(latest);
    state = Object.assign({}, state, {
      lastEncounterAt: record.occurredAt,
      lastEncounterId: record.encounterId,
      lastEncounterText: `${formatEncounterTime(record.occurredAt)}${record.timeEstimated ? "（约）" : ""}`,
      lastEncounterTimeEstimated: record.timeEstimated,
      lastEncounterRssi: record.rssi,
      encounterCount: encounterStore.getDisplayRecords().length,
      lastEncounterProfile: record.profile,
      encounterProfileLoading: false,
      encounterProfileMessage: record.profile ? "" : (
        record.errorMessage || "可以重新获取对方名片"
      )
    });
  } catch (error) {
    console.warn("本地相遇记录恢复失败：", error && error.message);
  }
}

function resumeLatestEncounterResolution() {
  const record = encounterStore.getLatestRecord();
  if (!record || record.profile || !record.peerToken) return Promise.resolve(null);
  setState({
    encounterProfileLoading: true,
    encounterProfileMessage: "正在获取对方的公开名片…"
  });
  return resolveEncounterProfile(record.encounterId, record.peerToken);
}

function enqueueSocialEncounterAck(encounterId) {
  if (!pendingSocialAcks.includes(encounterId)) pendingSocialAcks.push(encounterId);
  scheduleSocialAckPump(0);
}

function scheduleSocialAckPump(delay) {
  if (socialAckRetryTimer) return;
  socialAckRetryTimer = setTimeout(() => {
    socialAckRetryTimer = null;
    pumpSocialEncounterAcks();
  }, delay || 0);
}

function pumpSocialEncounterAcks() {
  if (socialAckInFlight || !pendingSocialAcks.length) return;
  if (!state.connected || !state.ready) return;
  if (pendingRequest) {
    scheduleSocialAckPump(80);
    return;
  }

  const encounterId = pendingSocialAcks[0];
  socialAckInFlight = true;
  request(
    config.COMMANDS.ACK_SOCIAL_ENCOUNTER,
    protocol.buildEncounterAckPayload(encounterId),
    { timeout: 1800, retries: 2 }
  ).then(() => {
    if (pendingSocialAcks[0] === encounterId) pendingSocialAcks.shift();
  }).catch(error => {
    console.warn("相遇事件 ACK 失败，等待重试：", error && error.message);
  }).finally(() => {
    socialAckInFlight = false;
    if (pendingSocialAcks.length && state.connected) scheduleSocialAckPump(1200);
  });
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

async function connectDevice(deviceId, options) {
  if (!deviceId) throw new Error("请选择要连接的云团挂件");
  const connectOptions = options || {};
  if (connectOptions.reconnectGeneration === undefined) {
    reconnectGeneration += 1;
  } else {
    assertReconnectGeneration(connectOptions.reconnectGeneration);
  }
  cancelReconnect();
  const operationGeneration = connectionOperationGeneration += 1;
  intentionalDisconnect = false;
  clearBatteryUnavailableTimer();
  setState({
    connecting: true,
    reconnecting: connectOptions.reconnectGeneration !== undefined,
    ready: false,
    battery: null,
    batteryStatus: "reading",
    errorMessage: "",
    statusText: "正在连接挂件…"
  });
  try {
    const rememberedName = deviceId === lastDeviceId ? lastDeviceName : "";
    await bleService.connectDevice(deviceId, rememberedName);
    assertConnectionOperation(operationGeneration);
    await initializeConnectedDevice();
    assertConnectionOperation(operationGeneration);
    const transport = bleService.getState();
    if (!transport.simulated) rememberDevice(deviceId, transport.deviceName || state.name);
    reconnectIndex = 0;
    setState({ reconnecting: false });
    return result({ device: toDevice() });
  } catch (error) {
    if ((error && error.cancelled) || operationGeneration !== connectionOperationGeneration) {
      throw createReconnectCancelledError();
    }
    intentionalDisconnect = true;
    try { await bleService.disconnectDevice(); } catch (ignore) {}
    setState({ connecting: false, ready: false, errorMessage: error.message, statusText: "设备初始化失败" });
    throw error;
  }
}

async function loadSimulator() {
  reconnectGeneration += 1;
  connectionOperationGeneration += 1;
  cancelReconnect();
  intentionalDisconnect = false;
  await bleService.loadSimulator();
  await initializeConnectedDevice();
  return result({ device: toDevice() });
}

function simulateSocialEncounter(peerToken, rssi) {
  requireReady();
  if (!state.simulated) throw new Error("请先加载模拟挂件");
  if (!state.socialMode) throw new Error("请先开启模拟挂件的社交模式");
  const normalizedToken = Number(peerToken);
  if (!Number.isInteger(normalizedToken) || normalizedToken <= 0 || normalizedToken > 0xFFFFFFFF) {
    throw new Error("对方模拟 Token 格式不正确");
  }
  if ((normalizedToken >>> 0) === (state.ownSocialToken >>> 0)) {
    throw new Error("不能模拟遇见当前挂件自己");
  }
  bleService.emitSimulatorSocialEncounter(normalizedToken >>> 0, Number(rssi) || -55);
  return Promise.resolve(result({ device: toDevice() }));
}

async function initializeConnectedDevice() {
  const transport = bleService.getState();
  assertRequiredGatt(transport.services);

  // 18 字节相遇 payload 加 10 字节控制帧开销，共 28 字节；ATT Notify
  // 还需要 3 字节头，因此必须在订阅 Event TX 前把 MTU 协商到至少 31。
  const controlMtu = await bleService.negotiateMTU(247, "write");
  if (controlMtu < config.controlMinMTU) {
    throw new Error(`当前 BLE MTU ${controlMtu} 过低，可靠相遇事件至少需要 ${config.controlMinMTU}`);
  }

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

  if (protocol.hasCapability(info.capabilities, config.capabilities.timeSync)) {
    await request(
      config.COMMANDS.SET_TIME,
      protocol.buildUint32Payload(Math.floor(Date.now() / 1000))
    );
  }

  await getStatus();
  if (protocol.hasCapability(info.capabilities, config.capabilities.alertSettings)) {
    const savedSettings = settingsService.getSettings();
    const settingsResponse = await request(
      config.COMMANDS.SET_ALERT_SETTINGS,
      protocol.buildAlertSettingsPayload(savedSettings)
    );
    setState(protocol.parseAlertSettingsData(settingsResponse.data));
  }
  if (protocol.hasCapability(info.capabilities, config.capabilities.socialEncounter)) {
    const tokenResponse = await request(config.COMMANDS.GET_SOCIAL_TOKEN);
    if (tokenResponse.data.length !== 4) throw new Error("挂件匿名令牌长度不正确");
    setState({ ownSocialToken: protocol.readUint32LE(tokenResponse.data, 0) });
  }
  setState({ connecting: false, connected: true, ready: true, statusText: "设备已就绪", errorMessage: "" });
  scheduleSocialAckPump(0);
  resumeLatestEncounterResolution().catch(() => {});
  refreshSocialRegistration(true).catch(error => {
    console.warn("社交匿名令牌登记失败：", error && error.message);
  });
}

async function refreshSocialRegistration(force) {
  if (!state.connected || !state.ownSocialToken) return { registered: false };
  const now = Date.now();
  if (!force && registeredSocialToken === state.ownSocialToken &&
      socialRegistrationExpiresAt - now > SOCIAL_REGISTRATION_LEEWAY_MS) {
    return { registered: true, expiresAt: socialRegistrationExpiresAt, cached: true };
  }
  if (socialRegistrationPromise) return socialRegistrationPromise;

  const token = state.ownSocialToken;
  socialRegistrationPromise = socialService.registerToken(token)
    .then(result => {
      registeredSocialToken = token;
      socialRegistrationExpiresAt = Number(result.expiresAt) || 0;
      scheduleSocialRegistrationRefresh();
      return Object.assign({ registered: true }, result);
    })
    .finally(() => {
      socialRegistrationPromise = null;
    });
  return socialRegistrationPromise;
}

function scheduleSocialRegistrationRefresh() {
  if (socialRegistrationTimer) clearTimeout(socialRegistrationTimer);
  socialRegistrationTimer = null;
  if (!state.connected || !socialRegistrationExpiresAt) return;
  const untilRefresh = Math.max(
    60 * 1000,
    Math.min(
      SOCIAL_REGISTRATION_REFRESH_MS,
      socialRegistrationExpiresAt - Date.now() - SOCIAL_REGISTRATION_LEEWAY_MS
    )
  );
  socialRegistrationTimer = setTimeout(() => {
    socialRegistrationTimer = null;
    refreshSocialRegistration(true).catch(error => {
      console.warn("社交匿名令牌自动续期失败：", error && error.message);
      scheduleSocialRegistrationRefresh();
    });
  }, untilRefresh);
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
  // 标准 Battery Level 不支持“未知”值，固件启动时只能放一个合法占位值。
  // 实际展示以随后 GET_STATUS 的 battery/0xFF 为准，避免把占位 0 当成真实电量。
  setState(patch);
}

async function getStatus() {
  const response = await request(config.COMMANDS.GET_STATUS);
  const status = protocol.parseStatusData(response.data);
  setState({
    socialMode: status.socialMode,
    uptime: status.uptime
  });
  applyBatteryReading(status.battery, true);
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

async function setAlertSettings(value) {
  requireReady();
  if (!protocol.hasCapability(state.capabilities, config.capabilities.alertSettings)) {
    throw new Error("当前挂件不支持提醒设置");
  }
  const settings = settingsService.normalizeSettings(value);
  const response = await request(
    config.COMMANDS.SET_ALERT_SETTINGS,
    protocol.buildAlertSettingsPayload(settings)
  );
  const applied = protocol.parseAlertSettingsData(response.data);
  setState(applied);
  return result({ settings: applied, device: toDevice() });
}

async function findDevice(alertType, duration) {
  requireReady();
  if (!protocol.hasCapability(state.capabilities, config.capabilities.findDevice)) {
    throw new Error("当前挂件不支持查找提醒");
  }
  await request(
    config.COMMANDS.FIND_DEVICE,
    protocol.buildFindDevicePayload(
      // 用户主动查找挂件时始终震动、播放提示旋律并闪灯，不受社交震动开关影响。
      alertType === undefined ? 2 : alertType,
      duration || 1500
    ),
    { timeout: 3000, retries: 1 }
  );
  setState({ lastEventText: "挂件正在震动、播放提示音并闪灯" });
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
  reconnectGeneration += 1;
  connectionOperationGeneration += 1;
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

function scheduleReconnect(generation) {
  if (generation !== reconnectGeneration) return;
  if (reconnectTimer || reconnectIndex >= RECONNECT_DELAYS.length) {
    if (reconnectIndex >= RECONNECT_DELAYS.length) {
      setState({
        reconnecting: false,
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
  setState({ reconnecting: true, statusText: `${delay / 1000} 秒后尝试重新连接…` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (generation !== reconnectGeneration) return;
    connectDevice(lastDeviceId, { reconnectGeneration: generation }).catch(error => {
      if ((error && error.cancelled) || generation !== reconnectGeneration) return;
      intentionalDisconnect = false;
      scheduleReconnect(generation);
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
  const generation = reconnectGeneration += 1;
  reconnectIndex = 0;
  cancelReconnect();
  setState({
    reconnecting: true,
    canReconnect: true,
    rememberedDeviceName: lastDeviceName,
    statusText: `正在重新连接${lastDeviceName ? ` ${lastDeviceName}` : "上次的挂件"}…`,
    errorMessage: ""
  });
  try {
    return await connectDevice(lastDeviceId, { reconnectGeneration: generation });
  } catch (error) {
    if ((error && error.cancelled) || generation !== reconnectGeneration) {
      if (silent) return result({ device: toDevice() });
      throw createReconnectCancelledError();
    }
    intentionalDisconnect = false;
    scheduleReconnect(generation);
    if (silent) return result({ device: toDevice() });
    throw error;
  }
}

async function cancelReconnectLastDevice() {
  reconnectGeneration += 1;
  connectionOperationGeneration += 1;
  reconnectIndex = 0;
  intentionalDisconnect = true;
  cancelReconnect();
  const cancelledError = createReconnectCancelledError();
  rejectPending(cancelledError);
  rejectValueWaiters(cancelledError);
  // 先同步使连接代次失效并立即更新界面，不等待 Android BLE 关闭回调。
  // 底层会在迟到的 createBLEConnection 成功后再次执行兜底关闭。
  bleService.disconnectDevice().catch(() => {});
  resetConnectionState("已停止重新连接");
  setState({
    canReconnect: Boolean(lastDeviceId),
    rememberedDeviceName: lastDeviceName,
    statusText: "已停止重新连接",
    errorMessage: ""
  });
  return result({ device: toDevice() });
}

function loadRememberedDevice() {
  if (rememberedDeviceLoaded) return;
  rememberedDeviceLoaded = true;
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") return;
  const saved = wx.getStorageSync(LAST_DEVICE_STORAGE_KEY);
  if (!saved || typeof saved !== "object" || typeof saved.deviceId !== "string") return;
  lastDeviceId = saved.deviceId;
  lastDeviceName = normalizeDeviceName(saved.name, lastDeviceId, config.defaultDeviceName);
  if (saved.name !== lastDeviceName && typeof wx.setStorageSync === "function") {
    wx.setStorageSync(LAST_DEVICE_STORAGE_KEY, { deviceId: lastDeviceId, name: lastDeviceName });
  }
  setState({ canReconnect: Boolean(lastDeviceId), rememberedDeviceName: lastDeviceName });
}

function rememberDevice(deviceId, name) {
  lastDeviceId = deviceId;
  lastDeviceName = normalizeDeviceName(name, deviceId, config.defaultDeviceName);
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

function createReconnectCancelledError() {
  const error = new Error("已停止重新连接");
  error.cancelled = true;
  return error;
}

function assertReconnectGeneration(generation) {
  if (generation !== reconnectGeneration) throw createReconnectCancelledError();
}

function assertConnectionOperation(generation) {
  if (generation !== connectionOperationGeneration) throw createReconnectCancelledError();
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
  clearBatteryUnavailableTimer();
  if (socialRegistrationTimer) clearTimeout(socialRegistrationTimer);
  socialRegistrationTimer = null;
  registeredSocialToken = 0;
  socialRegistrationExpiresAt = 0;
  let encounterPatch = {};
  try {
    const latest = encounterStore.getLatestRecord();
    const record = latest ? encounterStore.toDisplayRecord(latest) : null;
    if (record) {
      encounterPatch = {
        lastEncounterAt: record.occurredAt,
        lastEncounterId: record.encounterId,
        lastEncounterText: `${formatEncounterTime(record.occurredAt)}${record.timeEstimated ? "（约）" : ""}`,
        lastEncounterTimeEstimated: record.timeEstimated,
        lastEncounterRssi: record.rssi,
        encounterCount: encounterStore.getDisplayRecords().length,
        lastEncounterProfile: record.profile,
        encounterProfileLoading: false,
        encounterProfileMessage: record.profile ? "" : (
          record.errorMessage || "可以重新获取对方名片"
        )
      };
    }
  } catch (error) {
    console.warn("断开连接后恢复相遇记录失败：", error && error.message);
  }
  setState(Object.assign({}, initialState, encounterPatch, {
    initialized: state.initialized,
    available: state.available,
    devices: state.devices,
    statusText
  }));
}

function nextSequence() {
  sequence = sequence >= 255 ? 1 : sequence + 1;
  return sequence;
}

function requireReady() {
  if (!state.ready || !state.connected) throw new Error("设备尚未完成初始化");
}

function toDevice() { return buildDeviceView(state); }

function getDevice() {
  return Promise.resolve(result({ device: toDevice(), devices: getDisplayDevices() }));
}

function getHomeOverview() {
  return Promise.resolve(result(homeOverview(state)));
}

module.exports = {
  initialize,
  startScan,
  stopScan,
  getDisplayDevices,
  connectDevice,
  reconnectLastDevice,
  cancelReconnectLastDevice,
  loadSimulator,
  simulateSocialEncounter,
  disconnectDevice,
  getDevice,
  getHomeOverview,
  getStatus,
  setSocialMode,
  setAlertSettings,
  findDevice,
  setTime,
  ping,
  refreshSocialRegistration,
  retryLastEncounterProfile,
  retryEncounterProfile,
  getEncounterRecords,
  clearLocalPrivateState,
  getState,
  subscribe
};

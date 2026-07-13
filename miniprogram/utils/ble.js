/**
 * 微信小程序 BLE 底层 API 封装。
 *
 * 本文件只处理蓝牙适配器、扫描、连接、服务发现、特征值读写和事件监听，
 * 不包含“绑定设备”“社交模式”等业务逻辑，也不依赖任何具体硬件 UUID。
 */

const BLE_ERROR_MESSAGES = {
  10000: "蓝牙尚未初始化",
  10001: "手机蓝牙不可用，请先打开蓝牙",
  10002: "没有找到指定设备",
  10003: "蓝牙设备连接失败",
  10004: "没有找到指定蓝牙服务",
  10005: "没有找到指定蓝牙特征值",
  10006: "蓝牙连接已断开",
  10007: "当前特征值不支持此操作",
  10008: "蓝牙系统发生异常",
  10009: "当前手机系统不支持 BLE",
  10010: "设备已经连接",
  10011: "设备需要配对后才能连接",
  10012: "蓝牙操作超时",
  10013: "蓝牙设备参数无效"
};

function getWx() {
  if (typeof wx === "undefined") {
    throw createBleError(null, "当前环境不支持微信蓝牙 API");
  }
  return wx;
}

function createBleError(error, fallbackMessage) {
  const errCode = error && typeof error.errCode === "number" ? error.errCode : null;
  const message = BLE_ERROR_MESSAGES[errCode] || fallbackMessage || "蓝牙操作失败，请稍后重试";
  const result = new Error(message);
  result.errCode = errCode;
  result.errMsg = error && error.errMsg ? error.errMsg : "";
  result.originalError = error || null;
  return result;
}

function requireValue(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw createBleError(null, `缺少蓝牙参数：${fieldName}`);
  }
}

function callWxApi(apiName, options) {
  return new Promise((resolve, reject) => {
    let wxApi;
    try {
      wxApi = getWx();
      if (typeof wxApi[apiName] !== "function") {
        reject(createBleError(null, `当前微信版本不支持 ${apiName}`));
        return;
      }
    } catch (error) {
      reject(error);
      return;
    }

    wxApi[apiName](Object.assign({}, options || {}, {
      success: resolve,
      fail(error) {
        // 页面只接收简短中文提示，完整微信错误仍保存在 originalError 中便于排查。
        reject(createBleError(error));
      }
    }));
  });
}

function openAdapter(options) {
  return callWxApi("openBluetoothAdapter", options);
}

function closeAdapter() {
  return callWxApi("closeBluetoothAdapter");
}

function getAdapterState() {
  return callWxApi("getBluetoothAdapterState");
}

function startDiscovery(options) {
  const discoveryOptions = options || {};
  return callWxApi("startBluetoothDevicesDiscovery", {
    services: Array.isArray(discoveryOptions.services) ? discoveryOptions.services : [],
    allowDuplicatesKey: Boolean(discoveryOptions.allowDuplicatesKey),
    interval: discoveryOptions.interval,
    powerLevel: discoveryOptions.powerLevel
  });
}

function stopDiscovery() {
  return callWxApi("stopBluetoothDevicesDiscovery");
}

function getDevices() {
  return callWxApi("getBluetoothDevices");
}

function getConnectedDevices(services) {
  if (!Array.isArray(services) || !services.length) {
    return Promise.reject(createBleError(null, "查询已连接设备时必须提供 Service UUID"));
  }
  return callWxApi("getConnectedBluetoothDevices", { services });
}

function connect(deviceId, timeout) {
  try {
    requireValue(deviceId, "deviceId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("createBLEConnection", { deviceId, timeout });
}

function disconnect(deviceId) {
  try {
    requireValue(deviceId, "deviceId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("closeBLEConnection", { deviceId });
}

function getServices(deviceId) {
  try {
    requireValue(deviceId, "deviceId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("getBLEDeviceServices", { deviceId });
}

function getCharacteristics(deviceId, serviceId) {
  try {
    requireValue(deviceId, "deviceId");
    requireValue(serviceId, "serviceId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("getBLEDeviceCharacteristics", { deviceId, serviceId });
}

function enableNotify(options) {
  const params = options || {};
  try {
    requireValue(params.deviceId, "deviceId");
    requireValue(params.serviceId, "serviceId");
    requireValue(params.characteristicId, "characteristicId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("notifyBLECharacteristicValueChange", {
    deviceId: params.deviceId,
    serviceId: params.serviceId,
    characteristicId: params.characteristicId,
    state: params.state !== false,
    type: params.type
  });
}

function disableNotify(options) {
  return enableNotify(Object.assign({}, options || {}, { state: false }));
}

function readValue(options) {
  const params = options || {};
  try {
    requireValue(params.deviceId, "deviceId");
    requireValue(params.serviceId, "serviceId");
    requireValue(params.characteristicId, "characteristicId");
  } catch (error) {
    return Promise.reject(error);
  }

  // 该 Promise 只表示“读取指令发送成功”；真正的值由 onValueChange 回调获得。
  return callWxApi("readBLECharacteristicValue", {
    deviceId: params.deviceId,
    serviceId: params.serviceId,
    characteristicId: params.characteristicId
  });
}

function writeValue(options) {
  const params = options || {};
  let value;
  try {
    requireValue(params.deviceId, "deviceId");
    requireValue(params.serviceId, "serviceId");
    requireValue(params.characteristicId, "characteristicId");
    value = toArrayBuffer(params.value);
  } catch (error) {
    return Promise.reject(error);
  }

  return callWxApi("writeBLECharacteristicValue", {
    deviceId: params.deviceId,
    serviceId: params.serviceId,
    characteristicId: params.characteristicId,
    value,
    writeType: params.writeType
  });
}

function getRSSI(deviceId) {
  try {
    requireValue(deviceId, "deviceId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("getBLEDeviceRSSI", { deviceId });
}

function setMTU(deviceId, mtu) {
  try {
    requireValue(deviceId, "deviceId");
    if (!Number.isInteger(mtu) || mtu < 23) {
      throw createBleError(null, "MTU 必须是大于或等于 23 的整数");
    }
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("setBLEMTU", { deviceId, mtu });
}

function getMTU(deviceId, writeType) {
  try {
    requireValue(deviceId, "deviceId");
  } catch (error) {
    return Promise.reject(error);
  }
  return callWxApi("getBLEMTU", { deviceId, writeType });
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw createBleError(null, "写入蓝牙的数据必须是 ArrayBuffer 或 TypedArray");
}

function addListener(onApiName, offApiName, listener) {
  if (typeof listener !== "function") {
    throw createBleError(null, "蓝牙事件监听器必须是函数");
  }

  const wxApi = getWx();
  if (typeof wxApi[onApiName] !== "function") {
    throw createBleError(null, `当前微信版本不支持 ${onApiName}`);
  }
  wxApi[onApiName](listener);

  // 返回注销函数，页面或 service 销毁时必须调用，避免重复监听和内存泄漏。
  return function unsubscribe() {
    if (typeof wxApi[offApiName] === "function") {
      wxApi[offApiName](listener);
    }
  };
}

function onAdapterStateChange(listener) {
  return addListener("onBluetoothAdapterStateChange", "offBluetoothAdapterStateChange", listener);
}

function onDeviceFound(listener) {
  return addListener("onBluetoothDeviceFound", "offBluetoothDeviceFound", listener);
}

function onConnectionStateChange(listener) {
  return addListener("onBLEConnectionStateChange", "offBLEConnectionStateChange", listener);
}

function onValueChange(listener) {
  return addListener("onBLECharacteristicValueChange", "offBLECharacteristicValueChange", listener);
}

module.exports = {
  openAdapter,
  closeAdapter,
  getAdapterState,
  startDiscovery,
  stopDiscovery,
  getDevices,
  getConnectedDevices,
  connect,
  disconnect,
  getServices,
  getCharacteristics,
  enableNotify,
  disableNotify,
  readValue,
  writeValue,
  getRSSI,
  setMTU,
  getMTU,
  onAdapterStateChange,
  onDeviceFound,
  onConnectionStateChange,
  onValueChange,
  toArrayBuffer,
  createBleError
};

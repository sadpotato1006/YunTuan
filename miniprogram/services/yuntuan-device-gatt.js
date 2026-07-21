function createGattHelpers(config) {
  function normalizeUuid(value) {
    return String(value || "").replace(/-/g, "").toUpperCase();
  }

  function sameUuid(first, second) {
    return normalizeUuid(first) === normalizeUuid(second);
  }

  function findCharacteristic(services, serviceId, characteristicId) {
    const service = (services || []).find(item => sameUuid(item.uuid, serviceId));
    if (!service) return null;
    return (service.characteristics || []).find(item => sameUuid(item.uuid, characteristicId)) || null;
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
      if (!findCharacteristic(services, item[0], item[1])) {
        throw new Error(`设备缺少必需特征值：${item[2]}`);
      }
    });
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
    if (info.reserved !== undefined && info.reserved !== 0) {
      throw new Error("Protocol Info 保留字节必须为 0");
    }
  }

  return { assertRequiredGatt, findCharacteristic, sameUuid, validateProtocolInfo };
}

module.exports = { createGattHelpers };

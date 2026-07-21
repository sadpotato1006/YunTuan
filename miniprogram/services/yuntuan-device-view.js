function toDevice(state) {
  return {
    id: state.deviceId || "", name: state.name || "云团智能挂件", connected: state.connected,
    connecting: state.connecting, ready: state.ready, simulated: state.simulated,
    canReconnect: state.canReconnect, rememberedDeviceName: state.rememberedDeviceName,
    battery: state.battery, socialMode: state.socialMode,
    socialReminder: state.socialReminder, vibration: state.vibration, sound: state.sound,
    uptime: state.uptime, protocolMajor: state.protocolMajor, protocolMinor: state.protocolMinor,
    capabilities: state.capabilities, securityMode: state.securityMode, bindState: state.bindState,
    modelNumber: state.modelNumber, firmwareRevision: state.firmwareRevision,
    hardwareRevision: state.hardwareRevision, serialNumber: state.serialNumber,
    statusText: state.statusText, errorMessage: state.errorMessage, lastEventText: state.lastEventText,
    lastEncounterAt: state.lastEncounterAt, lastEncounterId: state.lastEncounterId,
    lastEncounterText: state.lastEncounterText, lastEncounterTimeEstimated: state.lastEncounterTimeEstimated,
    lastEncounterRssi: state.lastEncounterRssi, encounterCount: state.encounterCount,
    lastEncounterProfile: state.lastEncounterProfile, encounterProfileLoading: state.encounterProfileLoading,
    encounterProfileMessage: state.encounterProfileMessage, ownSocialToken: state.ownSocialToken >>> 0
  };
}

function homeOverview(state) {
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "早上好，愿您今天心情舒畅" : (hour < 18 ? "下午好，记得给自己一点休息时间" : "晚上好，今天也辛苦啦");
  return {
    greeting,
    careTip: state.connected
      ? "云团挂件连接正常，出门前记得查看电量。"
      : "云团挂件尚未连接，可以前往设备页进行连接。",
    device: toDevice(state)
  };
}

function result(data) { return { code: 0, message: "success", data }; }
module.exports = { toDevice, homeOverview, result };

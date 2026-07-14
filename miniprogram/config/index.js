const config = {
  // 通用后端可选值：mock、cloud、http；设备业务还支持本机 ble 模式。
  backendMode: "cloud",

  // 设备使用本机 BLE，聊天使用云函数，情绪功能暂时保留 Mock。
  serviceBackendModes: {
    chat: "cloud",
    device: "ble",
    emotion: "mock"
  },

  // 使用项目现有的云开发环境，切勿替换成其他环境 ID。
  cloudEnvId: "cloudbase-d7g2y0azb4f5dcf00",

  // 自建服务器地址，仅 http 模式使用。
  baseUrl: "https://example.com/api",
  requestTimeout: 10000
};

config.getBackendMode = function getBackendMode(serviceName) {
  return config.serviceBackendModes[serviceName] || config.backendMode;
};

config.usesCloudBackend = function usesCloudBackend() {
  return config.backendMode === "cloud" ||
    Object.keys(config.serviceBackendModes).some(name => config.serviceBackendModes[name] === "cloud");
};

module.exports = config;

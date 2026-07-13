const config = {
  // 当前调用已部署的 chat 云函数；可选值：mock、cloud、http。
  backendMode: "cloud",

  // 各业务可以独立覆盖默认模式：目前仅聊天使用云函数，其余功能继续使用 Mock。
  serviceBackendModes: {
    chat: "cloud",
    device: "mock",
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

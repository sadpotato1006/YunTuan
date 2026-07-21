const commonCloudProfile = {
  backendMode: "cloud",
  serviceBackendModes: {
    chat: "cloud",
    device: "ble",
    emotion: "cloud"
  },
  // 当前项目三个版本统一使用同一个已部署的微信云开发环境。
  cloudEnvId: "cloudbase-d7g2y0azb4f5dcf00",
  streamChatEnabled: true,
  streamChatFunctionName: "chat-stream",
  streamChatPath: "/chat",
  baseUrl: "https://example.com/api",
  requestTimeout: 10000
};

function profile(overrides) {
  return Object.assign({}, commonCloudProfile, overrides || {}, {
    serviceBackendModes: Object.assign(
      {},
      commonCloudProfile.serviceBackendModes,
      overrides && overrides.serviceBackendModes || {}
    )
  });
}

module.exports = {
  develop: profile(),
  trial: profile(),
  release: profile()
};

module.exports = {
  // 当前开发阶段使用 mock；可选值：mock、cloud、http。
  backendMode: "mock",

  // 微信云开发环境 ID，仅 cloud 模式使用，创建环境后再填写。
  cloudEnvId: "",

  // 自建服务器地址，仅 http 模式使用。
  baseUrl: "https://example.com/api",
  requestTimeout: 10000
};

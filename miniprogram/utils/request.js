const config = require("../config/index");

function request(options) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${config.baseUrl}${options.url}`,
      method: options.method || "GET",
      data: options.data || {},
      header: Object.assign({ "content-type": "application/json" }, options.header || {}),
      timeout: options.timeout || config.requestTimeout,
      success(res) {
        // 统一处理 HTTP 错误和后端约定的业务错误。
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`请求失败（${res.statusCode}）`));
          return;
        }
        if (!res.data || typeof res.data.code !== "number") {
          reject(new Error("服务返回格式异常"));
          return;
        }
        if (res.data.code !== 0) {
          reject(new Error(res.data.message || "服务处理失败"));
          return;
        }
        resolve(res.data);
      },
      fail(error) {
        // 网络失败、超时等异常在这里转换成页面可直接展示的提示。
        const message = error && error.errMsg && error.errMsg.includes("timeout")
          ? "请求超时，请稍后重试"
          : "网络连接失败，请检查网络";
        reject(new Error(message));
      }
    });
  });
}

module.exports = request;

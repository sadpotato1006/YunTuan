const config = require("../config/index");

function callCloudFunction(name, data) {
  return new Promise((resolve, reject) => {
    if (config.backendMode !== "cloud") {
      reject(new Error("当前未启用云开发模式"));
      return;
    }
    if (!config.cloudEnvId) {
      reject(new Error("请先在配置中填写云开发环境 ID"));
      return;
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      reject(new Error("当前微信基础库不支持云开发"));
      return;
    }

    wx.cloud.callFunction({ name, data: data || {} })
      .then(response => {
        const result = response && response.result;
        // 所有云函数也必须遵循统一的 code/message/data 返回格式。
        if (!result || typeof result.code !== "number" || !("data" in result)) {
          reject(new Error("云函数返回格式异常"));
          return;
        }
        if (result.code !== 0) {
          reject(new Error(result.message || "云函数处理失败"));
          return;
        }
        resolve(result);
      })
      .catch(error => {
        const detail = error && error.errMsg ? error.errMsg : "未知错误";
        reject(new Error(`云函数调用失败：${detail}`));
      });
  });
}

module.exports = callCloudFunction;

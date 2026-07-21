const config = require("../config/index");
const diagnostics = require("../services/diagnostics");
const CLOUD_CALL_TIMEOUT_MS = 30000;

/**
 * 统一调用微信云函数，并把云端错误转换为页面可直接展示的 Error。
 */
function callCloudFunction(name, data) {
  const startedAt = Date.now();
  const action = data && data.action ? String(data.action) : "call";
  return new Promise((resolve, reject) => {
    if (!config.usesCloudBackend()) {
      reject(new Error("当前未启用云开发模式"));
      return;
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      reject(new Error("当前环境不支持微信云开发"));
      return;
    }

    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && !app.globalData.cloudInitialized) {
      reject(new Error("微信云开发尚未初始化，请检查环境配置"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      diagnostics.measure("cloud", `${name}.${action}`, startedAt, { ok: false, timeout: true }, "error");
      reject(new Error("云函数调用超时，请稍后重试"));
    }, CLOUD_CALL_TIMEOUT_MS);
    const resolveOnce = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      diagnostics.measure("cloud", `${name}.${action}`, startedAt, { ok: true });
      resolve(value);
    };
    const rejectOnce = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      diagnostics.measure("cloud", `${name}.${action}`, startedAt, {
        ok: false,
        code: Number(error && (error.code || error.errCode)) || 0
      }, "error");
      reject(error);
    };

    try {
      wx.cloud.callFunction({
        name,
        data: data || {},
        success(response) {
        const result = response && response.result;
        if (!result) {
          rejectOnce(new Error("云函数没有返回处理结果"));
          return;
        }
        // 所有云函数都必须遵循统一的 code/message/data 返回格式。
        if (typeof result !== "object" || typeof result.code !== "number" || !("data" in result)) {
          rejectOnce(new Error("云函数返回的数据格式不正确"));
          return;
        }
        if (result.code !== 0) {
          rejectOnce(new Error(result.message || "云函数调用失败"));
          return;
        }
          resolveOnce(result);
        },
        fail(error) {
        // 只记录微信返回的错误信息，不输出任何 AI 密钥或敏感配置。
        console.error(`调用云函数 ${name} 失败：`, error);
          rejectOnce(new Error(getFriendlyCloudError(error, name)));
        }
      });
    } catch (error) {
      rejectOnce(error instanceof Error ? error : new Error("云函数调用失败"));
    }
  });
}

/**
 * 微信底层 errMsg 往往很长，这里只向用户展示容易理解的简短提示。
 */
function getFriendlyCloudError(error, serviceName) {
  const message = error && error.errMsg ? error.errMsg : "";
  const serviceLabels = {
    chat: "聊天服务",
    social: "社交服务",
    emotion: "情绪记录服务"
  };
  const serviceLabel = serviceLabels[serviceName] || "云端服务";

  if (
    message.includes("-504003") ||
    message.includes("TIME_LIMIT_EXCEEDED") ||
    message.toLowerCase().includes("timed out")
  ) {
    return `${serviceLabel}响应时间有点长，请稍后再试`;
  }
  if (message.includes("FUNCTION_NOT_FOUND") || message.includes("-501000")) {
    return `${serviceLabel}尚未部署，请联系管理员`;
  }
  if (message.includes("NETWORK_ERROR") || message.toLowerCase().includes("network")) {
    return "网络连接不稳定，请稍后再试";
  }
  if (message.includes("ENV") || message.includes("environment")) {
    return "云开发环境配置有误，请联系管理员";
  }
  return `${serviceLabel}暂时不可用，请稍后再试`;
}

// 保留默认函数导出，避免影响 device、emotion 等现有 service；也支持具名导入。
module.exports = callCloudFunction;
module.exports.callCloudFunction = callCloudFunction;
module.exports.getFriendlyCloudError = getFriendlyCloudError;

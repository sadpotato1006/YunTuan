const cloud = require("wx-server-sdk");
const axios = require("axios");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * chat 云函数入口
 * event.message：小程序传来的用户消息
 */
exports.main = async (event, context) => {
  const message =
    typeof event.message === "string"
      ? event.message.trim()
      : "";

  // 防止前端传入空消息
  if (!message) {
    return {
      code: 400,
      message: "消息不能为空",
      data: {}
    };
  }

  // API Key 只从云函数环境变量中读取，不能放在小程序前端
  const apiUrl = process.env.AI_API_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  // 检查环境变量是否配置完整
  if (!apiUrl || !apiKey || !model) {
    console.error("AI 环境变量配置不完整");

    return {
      code: 500,
      message: "AI 服务尚未配置完整",
      data: {}
    };
  }

  try {
    // 在云函数中请求 AI 平台
    const response = await axios.post(
      apiUrl,
      {
        model,
        thinking: {
          type: "disabled"
        },
        // OpenAI Chat Completions 兼容格式
        messages: [
          {
            role: "system",
            content:
              "你是云团，一位耐心、温和的陪伴助手。你的主要用户是随迁老人。回答要简短、自然、易懂，不要使用复杂术语，不要冒充医生，也不要作出医疗诊断。"
          },
          {
            role: "user",
            content: message
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },

        // 避免 AI 平台长时间没有响应
        timeout: 20000
      }
    );

    // OpenAI Chat Completions 兼容接口的常见返回结构
    const reply =
      response.data &&
      response.data.choices &&
      response.data.choices[0] &&
      response.data.choices[0].message &&
      response.data.choices[0].message.content;

    if (!reply) {
      console.error("AI 返回格式异常：", response.data);

      return {
        code: 502,
        message: "AI 返回的数据格式异常",
        data: {}
      };
    }

    return {
      code: 0,
      message: "success",
      data: {
        reply,
        // 目前暂时不做真实情绪分析
        emotion: "unknown"
      }
    };
  } catch (error) {
    // 不要打印 API Key，只记录状态码和错误信息
    console.error("调用 AI 失败：", {
      message: error.message,
      status: error.response && error.response.status,
      responseData: error.response && error.response.data
    });

    return {
      code: 500,
      message: getFriendlyErrorMessage(error),
      data: {}
    };
  }
};

/**
 * 将接口错误转换成用户能理解的提示
 */
function getFriendlyErrorMessage(error) {
  const status = error.response && error.response.status;

  if (status === 401 || status === 403) {
    return "AI 服务认证失败，请检查 API Key";
  }

  if (status === 404) {
    return "AI 接口地址或模型名称不正确";
  }

  if (status === 429) {
    return "AI 请求过于频繁，请稍后再试";
  }

  if (error.code === "ECONNABORTED") {
    return "AI 响应超时，请稍后再试";
  }

  return "AI 服务暂时不可用，请稍后再试";
}
const cloud = require("wx-server-sdk");
const axios = require("axios");
const { asr } = require("tencentcloud-sdk-nodejs-asr");
const { tts } = require("tencentcloud-sdk-nodejs-tts");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * chat 云函数入口
 * event.message：小程序传来的用户消息
 */
exports.main = async (event, context) => {
  if (event.action === "transcribe") {
    return transcribeAudio(event);
  }
  if (event.action === "synthesize") {
    return synthesizeSpeech(event);
  }

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

const TTS_SAMPLE_RATE = 16000;
const TTS_MAX_CHARACTERS = 150;
const TTS_MAX_SECONDS = 60;

async function synthesizeSpeech(event) {
  const text = typeof event.text === "string" ? event.text.trim() : "";
  if (!text) return { code: 400, message: "朗读文字不能为空", data: {} };

  const codePoints = Array.from(text);
  if (codePoints.length > TTS_MAX_CHARACTERS) {
    return {
      code: 400,
      message: `单次朗读不能超过 ${TTS_MAX_CHARACTERS} 个字符`,
      data: {}
    };
  }

  const secretId = (process.env.TTS_SECRET_ID || process.env.ASR_SECRET_ID || "").trim();
  const secretKey = (process.env.TTS_SECRET_KEY || process.env.ASR_SECRET_KEY || "").trim();
  const sessionToken = (process.env.TTS_SESSION_TOKEN || process.env.ASR_SESSION_TOKEN || "").trim();
  if (!secretId || !secretKey) {
    return {
      code: 500,
      message: "语音合成服务尚未配置，请设置腾讯云 TTS 密钥",
      data: {}
    };
  }

  const TtsClient = tts.v20190823.Client;
  const client = new TtsClient({
    credential: {
      secretId,
      secretKey,
      token: sessionToken || undefined
    },
    region: process.env.TTS_REGION || "ap-shanghai",
    profile: {
      httpProfile: {
        endpoint: "tts.tencentcloudapi.com",
        reqTimeout: 30
      }
    }
  });

  const sessionId = `yuntuan-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  try {
    const response = await client.TextToVoice({
      Text: text,
      SessionId: sessionId,
      Volume: readNumberEnv("TTS_VOLUME", 0, -10, 10),
      Speed: readNumberEnv("TTS_SPEED", 0, -2, 6),
      ProjectId: 0,
      ModelType: 1,
      VoiceType: readIntegerEnv("TTS_VOICE_TYPE", 1001, 0, 200000000),
      PrimaryLanguage: 1,
      SampleRate: TTS_SAMPLE_RATE,
      Codec: "pcm",
      EnableSubtitle: false
    });

    if (!response || typeof response.Audio !== "string" || !response.Audio) {
      throw new Error("腾讯云 TTS 没有返回音频数据");
    }

    const received = Buffer.from(response.Audio, "base64");
    const pcm = extractPcm16Mono(received, TTS_SAMPLE_RATE);
    const sampleCount = pcm.length / 2;
    if (!sampleCount) throw new Error("腾讯云 TTS 返回了空音频");
    if (sampleCount > TTS_SAMPLE_RATE * TTS_MAX_SECONDS) {
      return { code: 413, message: "合成语音过长，请缩短云团的回复", data: {} };
    }

    const encoded = encodePcm16ToImaAdpcm(pcm);
    return {
      code: 0,
      message: "success",
      data: {
        codec: "ima-adpcm",
        sampleRate: TTS_SAMPLE_RATE,
        bitsPerSample: 16,
        sampleCount,
        initialPredictor: encoded.initialPredictor,
        initialIndex: encoded.initialIndex,
        encodedBytes: encoded.data.length,
        crc32: crc32(encoded.data),
        audioBase64: encoded.data.toString("base64"),
        requestId: response.RequestId || ""
      }
    };
  } catch (error) {
    console.error("调用腾讯云语音合成失败：", {
      code: error.code,
      message: error.message,
      requestId: error.requestId
    });
    return { code: 500, message: getTtsErrorMessage(error), data: {} };
  }
}

function extractPcm16Mono(audio, expectedSampleRate) {
  if (!Buffer.isBuffer(audio) || !audio.length) throw new Error("TTS 音频数据为空");
  if (audio.length >= 12 && audio.toString("ascii", 0, 4) === "RIFF" &&
      audio.toString("ascii", 8, 12) === "WAVE") {
    let offset = 12;
    let format = null;
    let data = null;
    while (offset + 8 <= audio.length) {
      const id = audio.toString("ascii", offset, offset + 4);
      const size = audio.readUInt32LE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > audio.length) throw new Error("TTS WAV 分块长度不正确");
      if (id === "fmt " && size >= 16) {
        format = {
          audioFormat: audio.readUInt16LE(start),
          channels: audio.readUInt16LE(start + 2),
          sampleRate: audio.readUInt32LE(start + 4),
          bitsPerSample: audio.readUInt16LE(start + 14)
        };
      } else if (id === "data") {
        data = audio.subarray(start, end);
      }
      offset = end + (size & 1);
    }
    if (!format || !data) throw new Error("TTS WAV 缺少 fmt 或 data 分块");
    if (format.audioFormat !== 1 || format.channels !== 1 ||
        format.sampleRate !== expectedSampleRate || format.bitsPerSample !== 16) {
      throw new Error("TTS WAV 必须是 16kHz、16bit、单声道 PCM");
    }
    audio = data;
  }
  if (audio.length % 2 !== 0) throw new Error("TTS PCM 长度不是 16bit 对齐");
  return audio;
}

function encodePcm16ToImaAdpcm(pcm) {
  const sampleCount = pcm.length / 2;
  const initialPredictor = pcm.readInt16LE(0);
  const state = { predictor: initialPredictor, index: 0 };
  const output = Buffer.alloc(Math.ceil((sampleCount - 1) / 2));
  let outputIndex = 0;
  let lowNibble = 0;
  for (let sampleIndex = 1; sampleIndex < sampleCount; sampleIndex += 1) {
    const nibble = encodeImaNibble(pcm.readInt16LE(sampleIndex * 2), state);
    if ((sampleIndex - 1) % 2 === 0) {
      lowNibble = nibble;
    } else {
      output[outputIndex++] = lowNibble | (nibble << 4);
    }
  }
  if ((sampleCount - 1) % 2 === 1) output[outputIndex] = lowNibble;
  return { initialPredictor, initialIndex: 0, data: output };
}

const IMA_INDEX_TABLE = [
  -1, -1, -1, -1, 2, 4, 6, 8,
  -1, -1, -1, -1, 2, 4, 6, 8
];
const IMA_STEP_TABLE = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
  2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
  6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
  18500, 20350, 22385, 24623, 27086, 29794, 32767
];

function encodeImaNibble(sample, state) {
  let difference = sample - state.predictor;
  let nibble = 0;
  if (difference < 0) {
    nibble = 8;
    difference = -difference;
  }
  const step = IMA_STEP_TABLE[state.index];
  let delta = step >> 3;
  if (difference >= step) {
    nibble |= 4;
    difference -= step;
    delta += step;
  }
  if (difference >= (step >> 1)) {
    nibble |= 2;
    difference -= step >> 1;
    delta += step >> 1;
  }
  if (difference >= (step >> 2)) {
    nibble |= 1;
    delta += step >> 2;
  }
  state.predictor += (nibble & 8) ? -delta : delta;
  state.predictor = Math.max(-32768, Math.min(32767, state.predictor));
  state.index = Math.max(0, Math.min(88, state.index + IMA_INDEX_TABLE[nibble]));
  return nibble;
}

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function readNumberEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function readIntegerEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function getTtsErrorMessage(error) {
  const code = error && error.code ? error.code : "";
  if (/AuthFailure|InvalidCredential|UnauthorizedOperation|AuthorizationFailed/.test(code)) {
    return "语音合成认证失败，请检查腾讯云密钥和权限";
  }
  if (/ServerNotOpen|AppIdNotRegistered|ServiceIsolate/.test(code)) {
    return "腾讯云语音合成服务尚未开通";
  }
  if (/TextTooLong|InvalidText|TextEmpty/.test(code)) return "需要朗读的文字不符合腾讯云 TTS 要求";
  if (/LimitExceeded|RequestLimitExceeded|AccessLimit/.test(code)) return "语音合成请求过多，请稍后重试";
  if (/AccountArrears|NoFreeAccount|PkgExhausted/.test(code)) return "腾讯云语音合成额度不足";
  return "语音合成服务暂时不可用，请稍后再试";
}

async function transcribeAudio(event) {
  const secretId = (process.env.ASR_SECRET_ID || "").trim();
  const secretKey = (process.env.ASR_SECRET_KEY || "").trim();
  const sessionToken = (process.env.ASR_SESSION_TOKEN || "").trim();
  if (!secretId || !secretKey) {
    return {
      code: 500,
      message: "语音识别服务尚未配置，请设置腾讯云 ASR 密钥",
      data: {}
    };
  }

  const audioBase64 = typeof event.audioBase64 === "string" ? event.audioBase64 : "";
  let audioBuffer;
  try {
    audioBuffer = Buffer.from(audioBase64, "base64");
  } catch (error) {
    return { code: 400, message: "录音数据格式不正确", data: {} };
  }

  if (!audioBuffer.length) {
    return { code: 400, message: "录音内容为空", data: {} };
  }
  if (audioBuffer.length > 2 * 1024 * 1024) {
    return { code: 400, message: "录音文件过大，请缩短说话时间", data: {} };
  }

  const voiceFormat = typeof event.voiceFormat === "string"
    ? event.voiceFormat.toLowerCase()
    : "mp3";
  if (voiceFormat !== "mp3" && voiceFormat !== "wav") {
    return { code: 400, message: "录音格式不受支持", data: {} };
  }

  const AsrClient = asr.v20190614.Client;
  const client = new AsrClient({
    credential: {
      secretId,
      secretKey,
      token: sessionToken || undefined
    },
    region: process.env.ASR_REGION || "ap-shanghai",
    profile: {
      httpProfile: {
        endpoint: "asr.tencentcloudapi.com",
        reqTimeout: 20
      }
    }
  });

  try {
    const response = await client.SentenceRecognition({
      EngSerViceType: process.env.ASR_ENGINE || "16k_zh",
      SourceType: 1,
      VoiceFormat: voiceFormat,
      Data: audioBase64,
      DataLen: audioBuffer.length,
      FilterDirty: 0,
      FilterModal: 0,
      FilterPunc: 0,
      ConvertNumMode: 1,
      WordInfo: 0
    });
    const text = response && typeof response.Result === "string"
      ? response.Result.trim()
      : "";
    if (!text) {
      return { code: 422, message: "没有听清，请再说一次", data: {} };
    }
    return { code: 0, message: "success", data: { text } };
  } catch (error) {
    console.error("调用腾讯云语音识别失败：", {
      code: error.code,
      message: error.message,
      requestId: error.requestId
    });
    return {
      code: 500,
      message: getAsrErrorMessage(error),
      data: {}
    };
  }
}

function getAsrErrorMessage(error) {
  const code = error && error.code ? error.code : "";
  if (/AuthFailure|InvalidCredential|UnauthorizedOperation/.test(code)) {
    return "语音识别认证失败，请检查腾讯云密钥和权限";
  }
  if (/FailedOperation.ServiceIsolate/.test(code)) {
    return "腾讯云语音识别服务尚未开通";
  }
  if (/LimitExceeded|RequestLimitExceeded/.test(code)) {
    return "语音识别请求过多，请稍后重试";
  }
  return "语音识别服务暂时不可用，请稍后重试";
}

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

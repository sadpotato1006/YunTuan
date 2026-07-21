const assert = require("assert");
const Module = require("module");
const { Readable } = require("stream");
const {
  SentenceSegmenter,
  UpstreamSseParser,
  parseRequestEvent,
  parseUpstreamPayload,
  readNonStreamingReply
} = require("../cloudfunctions/chat-stream/stream-utils");
const { SseParser } = require("../miniprogram/utils/sse");

function testUpstreamParser() {
  const source = [
    "data: {\"choices\":[{\"delta\":{\"content\":\"您好，\"}}]}\n\n",
    "data: {\"choices\":[{\"delta\":{\"content\":\"今天感觉怎么样？\"}}]}\n\n",
    "data: [DONE]\n\n"
  ].join("");
  const bytes = Buffer.from(source, "utf8");
  const parser = new UpstreamSseParser();
  const payloads = [];
  for (let index = 0; index < bytes.length; index += 3) {
    payloads.push(...parser.push(bytes.subarray(index, index + 3)));
  }
  payloads.push(...parser.finish());

  const parsed = payloads.map(parseUpstreamPayload);
  assert.strictEqual(parsed.map(item => item.content).join(""), "您好，今天感觉怎么样？");
  assert.strictEqual(parsed[parsed.length - 1].done, true);
}

function testSentenceSegmenter() {
  const segmenter = new SentenceSegmenter(120, 40);
  assert.deepStrictEqual(segmenter.push("您好，今天感觉怎么样？后面这句"), ["您好，今天感觉怎么样？"]);
  const rest = segmenter.push("继续补充一些内容，帮助验证后续句段。")
    .concat(segmenter.finish());
  assert.strictEqual(rest.join(""), "后面这句继续补充一些内容，帮助验证后续句段。");
  assert.ok(rest.every(item => Array.from(item).length <= 40));

  const capped = new SentenceSegmenter(50, 20);
  const cappedSegments = capped.push("云".repeat(80)).concat(capped.finish());
  assert.strictEqual(Array.from(cappedSegments.join("")).length, 50);
  assert.ok(cappedSegments.every(item => Array.from(item).length <= 20));

  const adaptive = new SentenceSegmenter(120, 40, 16);
  const adaptiveFirst = adaptive.push("这是一段没有标点而且长度超过首段限制的回复内容");
  assert.strictEqual(adaptiveFirst.length, 1);
  assert.strictEqual(Array.from(adaptiveFirst[0]).length, 16);
  const adaptiveRest = adaptive.push("，后续内容仍然使用较长的句段限制。")
    .concat(adaptive.finish());
  assert.ok(adaptiveRest.every(item => Array.from(item).length <= 40));

  const naturalFirst = new SentenceSegmenter(120, 40, 16);
  assert.deepStrictEqual(
    naturalFirst.push("我明白你的意思了，后面继续详细说明"),
    ["我明白你的意思了，"]
  );

  assert.strictEqual(readNonStreamingReply({
    choices: [{ message: { content: "普通模式回复" } }]
  }), "普通模式回复");

  assert.deepStrictEqual(parseRequestEvent({ message: "对象消息", history: [] }), {
    message: "对象消息",
    history: []
  });
  assert.strictEqual(
    parseRequestEvent(Buffer.from('{"message":"Buffer 消息"}', "utf8")).message,
    "Buffer 消息"
  );
  assert.strictEqual(
    parseRequestEvent({ body: '{"message":"网关包装消息"}' }).message,
    "网关包装消息"
  );
  assert.strictEqual(
    parseRequestEvent({ data: { message: "data 包装消息" } }).message,
    "data 包装消息"
  );
}

function testMiniProgramParser() {
  const received = [];
  const parser = new SseParser(event => received.push(event));
  const source = Buffer.from(
    "event: segment\r\ndata: {\"content\":\"第一句。\"}\r\n\r\n" +
    "event: done\ndata: {\"reply\":\"第一句。\"}\n\n",
    "utf8"
  );
  for (let index = 0; index < source.length; index += 1) {
    parser.push(source.subarray(index, index + 1));
  }
  parser.finish();
  assert.deepStrictEqual(received, [
    { event: "segment", data: "{\"content\":\"第一句。\"}" },
    { event: "done", data: "{\"reply\":\"第一句。\"}" }
  ]);
}

async function testChatServiceStreaming() {
  const oldWx = global.wx;
  const chunks = [
    "event: start\ndata: {}\n\n",
    "event: segment\ndata: {\"index\":0,\"content\":\"第一句。\"}\n\n",
    "event: done\ndata: {\"reply\":\"第一句。\"}\n\n"
  ];
  global.wx = {
    cloud: {
      callHTTPFunction(options) {
        assert.strictEqual(options.method, "post");
        assert.strictEqual(options.header["content-type"], "application/json");
        assert.strictEqual(options.data.requestId, "chat_test_request_001");
        chunks.forEach(chunk => options.onChunkedReceived({ data: Buffer.from(chunk, "utf8") }));
        options.success({});
      }
    }
  };
  const chatService = require("../miniprogram/services/chat");
  const streamedSegments = [];
  const result = await chatService.streamMessage("测试", [], {
    onSegment: segment => streamedSegments.push(segment)
  }, "chat_test_request_001");
  assert.strictEqual(result.data.reply, "第一句。");
  assert.strictEqual(result.data.streamed, true);
  assert.deepStrictEqual(streamedSegments, ["第一句。"]);

  global.wx.cloud.callHTTPFunction = options => {
    options.onChunkedReceived({
      data: Buffer.from(
        "event: error\ndata: {\"message\":\"不支持 SSE\",\"fallbackAllowed\":true}\n\n",
        "utf8"
      )
    });
    options.success({});
  };
  await assert.rejects(
    chatService.streamMessage("测试降级", [], {}),
    error => error.canFallback === true && error.partialReply === ""
  );

  global.wx.cloud.callHTTPFunction = options => {
    options.fail({ errMsg: "callHTTPFunction:fail FUNCTION_NOT_FOUND -501000" });
  };
  await assert.rejects(
    chatService.streamMessage("测试函数未部署", [], {}),
    error => error.canFallback === true
  );

  global.wx.cloud.callHTTPFunction = options => {
    options.fail({ errMsg: "callHTTPFunction:fail NETWORK_ERROR" });
  };
  await assert.rejects(
    chatService.streamMessage("测试网络错误", [], {}),
    error => error.canFallback === false
  );

  let aborted = false;
  global.wx.cloud.callHTTPFunction = () => ({
    abort() { aborted = true; }
  });
  const cancellable = chatService.streamMessage(
    "测试停止生成",
    [],
    {},
    "chat_test_cancel_002"
  );
  cancellable.abort();
  await assert.rejects(cancellable, error => error.cancelled === true);
  assert.strictEqual(aborted, true);
  global.wx = oldWx;
}

async function testHttpFunction() {
  const usage = new Map();
  let streamSafetyCalls = 0;
  const createCollection = () => ({
    where(query) {
      return {
        limit() {
          return {
            async get() {
              const value = usage.get(query._id);
              return { data: value ? [Object.assign({}, value)] : [] };
            }
          };
        }
      };
    },
    async add(options) {
      usage.set(options.data._id, Object.assign({}, options.data));
      return {};
    },
    doc(id) {
      return {
        async get() {
          return { data: Object.assign({}, usage.get(id)) };
        },
        async set(options) {
          usage.set(id, Object.assign({ _id: id }, options.data));
          return {};
        }
      };
    }
  });
  const database = {
    collection: createCollection,
    async runTransaction(callback) {
      return callback({ collection: createCollection });
    }
  };
  const cloudStub = {
    DYNAMIC_CURRENT_ENV: "test",
    init() {},
    database() { return database; },
    openapi: {
      security: {
        async msgSecCheck() {
          streamSafetyCalls += 1;
          return { errCode: 0, result: { suggest: "pass", label: 100 } };
        }
      }
    }
  };
  let aiRequest = null;
  let aiRequestCount = 0;
  let forceCompatibilityFallback = false;
  const axiosStub = {
    async post(url, data) {
      aiRequest = { url, data };
      aiRequestCount += 1;
      if (forceCompatibilityFallback && data.stream) {
        const error = new Error("stream is unsupported");
        error.response = { status: 400 };
        throw error;
      }
      if (forceCompatibilityFallback) {
        return {
          headers: { "content-type": "application/json" },
          data: { choices: [{ message: { content: "普通响应也能完成。" } }] }
        };
      }
      return {
        headers: { "content-type": "text/event-stream" },
        data: Readable.from([
          "data: {\"choices\":[{\"delta\":{\"content\":\"您好！\"}}]}\n\n",
          "data: {\"choices\":[{\"delta\":{\"content\":\"今天也要照顾好自己。\"}}]}\n\n",
          "data: [DONE]\n\n"
        ])
      };
    }
  };

  const oldLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === "wx-server-sdk") return cloudStub;
    if (request === "axios") return axiosStub;
    return oldLoad.call(this, request, parent, isMain);
  };
  process.env.AI_API_URL = "https://ai.example.test/chat";
  process.env.AI_API_KEY = "test-key";
  process.env.AI_MODEL = "test-model";
  process.env.CHAT_CONTENT_SECURITY_ENABLED = "true";
  const app = require("../cloudfunctions/chat-stream/index");
  Module._load = oldLoad;

  const server = await new Promise(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wx-openid": "stream-test-user"
      },
      body: JSON.stringify({
        requestId: "chat_stream_first_001",
        message: "陪我聊聊天",
        history: [{ role: "assistant", content: "当然可以。" }]
      })
    });
    const body = await response.text();
    assert.strictEqual(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    assert.match(body, /event: segment/);
    assert.match(body, /event: done/);
    assert.match(body, /您好！今天也要照顾好自己。/);
    assert.ok(streamSafetyCalls >= 3);
    assert.strictEqual(aiRequest.data.stream, true);
    assert.deepStrictEqual(aiRequest.data.messages.slice(-2), [
      { role: "assistant", content: "当然可以。" },
      { role: "user", content: "陪我聊聊天" }
    ]);

    const duplicateResponse = await fetch(`http://127.0.0.1:${address.port}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wx-openid": "stream-test-user"
      },
      body: JSON.stringify({
        requestId: "chat_stream_first_001",
        message: "陪我聊聊天"
      })
    });
    const duplicateBody = await duplicateResponse.text();
    assert.match(duplicateBody, /event: done/);
    assert.match(duplicateBody, /"cached":true/);
    assert.strictEqual(aiRequestCount, 1);

    forceCompatibilityFallback = true;
    const compatibilityResponse = await fetch(`http://127.0.0.1:${address.port}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wx-openid": "stream-compatibility-user"
      },
      body: JSON.stringify({
        requestId: "chat_stream_compat_002",
        message: "测试普通兼容响应"
      })
    });
    const compatibilityBody = await compatibilityResponse.text();
    assert.match(compatibilityBody, /普通响应也能完成。/);
    assert.match(compatibilityBody, /event: done/);
    assert.strictEqual(aiRequest.data.stream, false);

    forceCompatibilityFallback = false;
    const wrappedResponse = await fetch(`http://127.0.0.1:${address.port}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-wx-openid": "stream-wrapped-body-user"
      },
      body: JSON.stringify({
        body: JSON.stringify({
          requestId: "chat_stream_wrapped_003",
          message: "包装请求也能读取"
        })
      })
    });
    const wrappedBody = await wrappedResponse.text();
    assert.match(wrappedBody, /event: done/);
    assert.strictEqual(aiRequest.data.messages[aiRequest.data.messages.length - 1].content,
      "包装请求也能读取");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  testUpstreamParser();
  testSentenceSegmenter();
  testMiniProgramParser();
  await testChatServiceStreaming();
  await testHttpFunction();
  console.log("chat stream tests passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

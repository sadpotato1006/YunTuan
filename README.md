# 云团微信小程序

“云团”是面向随迁老人的陪伴类产品。本仓库当前提供原生微信小程序前端、可部署的聊天云函数、Mock 数据，以及云团 BLE 控制、录音上行和语音播放实现。真实 AI、ASR 和 TTS 仍需云端环境变量，真实 BLE 功能需要与符合协议的挂件固件进行真机联调。

硬件联调请以 [云团智能挂件软硬件 BLE 通信协议 v0.2 评审稿](docs/YUNTUAN_BLE_PROTOCOL_REVIEW_V0.2.md) 为准。原 [v0.1 综合草案](docs/YUNTUAN_BLE_PROTOCOL_V0.1.md) 保留量产认证设计，尚未冻结。

## 后端模式

在 `miniprogram/config/index.js` 中修改 `backendMode`：

- `mock`：本地 Promise 模拟数据，无需网络、服务器或云开发环境，当前默认模式，适合界面和交互开发。
- `cloud`：由 `wx.cloud.callFunction` 调用微信云函数，适合承载 AI 调用、云数据库和设备绑定数据。
- `http`：由统一封装的 `wx.request` 调用自建服务器，未来可连接 Node.js、Python 或 Java 后端。
- `ble`：仅供设备业务使用，由手机直接连接附近的云团 BLE 挂件。

页面只调用 `services`，切换模式不需要修改页面。

也可以通过 `serviceBackendModes` 为不同业务单独指定模式。当前项目由聊天调用云函数，设备使用本机 BLE，情绪功能暂时使用 Mock：

```js
serviceBackendModes: {
  chat: "cloud",
  device: "ble",
  emotion: "mock"
}
```

某项未配置时，会自动使用 `backendMode` 作为默认值。

## 使用 Mock 模式

保持以下配置即可直接编译运行：

```js
backendMode: "mock",
cloudEnvId: ""
```

Mock 模式不会初始化或调用 `wx.cloud`，因此无需创建云环境。设备页还提供“加载模拟挂件”，可以在没有真实硬件时验证 v0.2 协议业务闭环。

## 使用微信云开发

1. 在微信开发者工具中打开“云开发”，按提示创建环境。
2. 在云开发控制台或开发者工具中复制环境 ID。
3. 将环境 ID 填入 `miniprogram/config/index.js` 的 `cloudEnvId`，并把 `backendMode` 改为 `cloud`。
4. 在开发者工具的 `cloudfunctions` 目录中，依次右键 `chat`、`device`、`emotion`。
5. 选择“上传并部署：云端安装依赖”。
6. 重新编译小程序。

`project.config.json` 已配置 `cloudfunctionRoot: "cloudfunctions/"`。

## 接入真实 AI

小程序前端只应调用 `chat` 云函数，不应直接调用 AI 平台。请在 `cloudfunctions/chat/index.js` 中接入 AI SDK 或 HTTP API，并将 API Key 配置为云函数环境变量或其他安全配置。

**任何 AI API Key 都不能写在小程序代码、配置文件或提交到源码仓库中。** 云函数收到小程序消息后调用 AI，再按 `{ code, message, data }` 格式返回结果。

`chat` 云函数同时提供腾讯云实时 ASR、一句话识别降级与 TTS。实时 ASR 除 `ASR_SECRET_ID`、`ASR_SECRET_KEY` 外还必须配置 `ASR_APP_ID`，并在微信公众平台把 `wss://asr.cloud.tencent.com` 加入 socket 合法域名。TTS 可设置 `TTS_SECRET_ID`、`TTS_SECRET_KEY`、`TTS_SESSION_TOKEN`、`TTS_REGION`、`TTS_VOICE_TYPE`、`TTS_SPEED` 和 `TTS_VOLUME`；未单独设置 TTS 密钥时会复用对应的 `ASR_*` 密钥。部署时必须选择“上传并部署：云端安装依赖”。

### 连续对话与上线保护

小程序会把最近最多 12 条、合计不超过 4000 个字符的对话作为上下文发送给 `chat` 云函数。云函数不会接受 `system` 角色，并会再次校验角色、单条长度、上下文总长度和当前消息长度。完整页面记录仍只保存在本机；`chat_usage` 不保存用户消息和对话上下文，但会保留最近 20 个请求的 AI 回复，用于断网重试时直接返回结果并避免重复计费。

部署新版 `chat` 云函数前，需要在云开发数据库中创建 `chat_usage` 集合，并把集合权限设置为仅云函数可读写。该集合用不可逆哈希后的微信 `OPENID` 作为文档 ID，记录分钟窗口、当日各类调用次数，以及最近 20 个聊天请求的幂等状态；每日额度按北京时间零点重置。小程序会为同一条消息生成稳定的 `requestId`，流式请求、普通模式降级和用户重试会复用它，因此已经完成的回复可直接从幂等缓存返回，不会再次调用 AI 或重复扣减额度。

当前开发版本按项目决定默认关闭微信内容安全检查，因此不会再因无效微信 access token 返回“内容安全检查暂时不可用”。如后续需要恢复，可把两个聊天函数的 `CHAT_CONTENT_SECURITY_ENABLED` 都设为 `true`，并保证 `security.msgSecCheck` 权限和微信调用凭据可用。

### 半流式语音回复

`chat-stream` 是独立的 HTTP 云函数。它向上游 AI 发送 `stream: true`，首个自然句段约 16 个字符，后续句段约 40 个字符；每个句段立即用 SSE 推给小程序。小程序收到首段后，不等待 AI 完整回复，直接启动 TTS，并让后续句段的 AI 接收、TTS 合成和当前语音的 BLE 播放并行执行。挂件协议已升级为 v2：录音、BLE 上行和实时 ASR 重叠，TTS 预缓冲约 400ms 后边收边播。

部署时需要额外完成以下配置：

1. 在云开发环境中把 `cloudfunctions/chat-stream` 创建或部署为 **HTTP 云函数**，启动文件使用 `scf_bootstrap`，监听端口为 `9000`，函数超时建议设为至少 60 秒；普通“上传并部署”不会自动把它转换成 HTTP 云函数。
2. 为 `chat-stream` 安装 `package.json` 中的云端依赖，并把 `AI_API_URL`、`AI_API_KEY`、`AI_MODEL` 以及所有 `CHAT_*` 保护环境变量配置成与 `chat` 一致。
3. 保留 `config.json` 中的 `security.msgSecCheck` 权限，并继续使用同一个仅云函数可读写的 `chat_usage` 集合。
4. 小程序调试基础库使用 `3.15.2` 或更高版本，以支持 `wx.cloud.callHTTPFunction` 的分块接收。

也可使用 CloudBase CLI 从项目根目录部署：

```powershell
tcb fn deploy chat-stream --httpFn
```

`miniprogram/config/index.js` 中的 `streamChatEnabled` 默认开启。若上游 AI 明确拒绝流式参数，`chat-stream` 会在同一次受限额保护的请求中改用普通 AI 响应；若基础库过旧或 HTTP 函数未部署，小程序会自动退回原 `chat` 云函数。一旦已展示或播放部分回复，则不会再次请求完整回复，避免内容重复。

### 情绪记录云存储

情绪功能使用 `emotion` 云函数，并按不可逆哈希后的微信 `OPENID` 隔离数据。部署前需在云开发数据库中创建 `emotion_records` 集合，将权限设为仅云函数可读写，然后重新部署 `emotion` 云函数。新用户默认没有记录；同一用户每天只保留一条，再次选择会更新当天记录。用户可填写最多 100 个字符的可选备注；点击输入框时会自动清空所选心情的默认语句，最终留空则仍保存并展示默认语句。页面最多返回最近 30 条。

可以通过以下云函数环境变量调整保护阈值：

| 环境变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `CHAT_RATE_WINDOW_SECONDS` | `60` | 用户级频率窗口，允许 10～3600 秒 |
| `CHAT_RATE_MAX_REQUESTS` | `12` | 单个窗口内聊天、ASR、TTS 的合计请求上限 |
| `CHAT_DAILY_CHAT_QUOTA` | `100` | 每人每天文字聊天上限 |
| `CHAT_DAILY_ASR_QUOTA` | `60` | 每人每天语音识别上限 |
| `CHAT_DAILY_TTS_QUOTA` | `100` | 每人每天语音合成上限 |
| `CHAT_CONTENT_SECURITY_ENABLED` | `false` | 当前开发版本关闭；设为 `true` 才启用微信内容安全检查 |

聊天保护逻辑测试：

```powershell
node tests\chat_guard_test.js
node tests\chat_stream_test.js
```

## 使用自建服务器

购买并部署服务器后：

1. 把 `backendMode` 改为 `http`。
2. 把 `baseUrl` 改为真实 HTTPS API 地址。
3. 在微信公众平台配置服务器域名白名单。
4. 让后端接口与现有 services 中的路径和统一返回结构保持一致。

HTTP 请求由 `miniprogram/utils/request.js` 统一处理成功响应、非 2xx 状态码、业务错误、网络失败和超时。

## BLE 说明

BLE 搜索、连接、断开和数据通信使用小程序端的微信蓝牙 API。当前已实现：

- `HELLO`、`GET_STATUS`、`SET_SOCIAL_MODE`、`FIND_DEVICE`、`PING`；
- Event TX 和标准 Battery Level 订阅；
- CRC-16/CCITT-FALSE 校验；
- Sequence 响应匹配、命令超时和有限重试；
- 1、3、5、10、15、30 秒退避重连，并保存最近一次成功连接的真实设备；
- 硬件 PTT 录音边采集边以 IMA-ADPCM 上传，并增量解码后调用实时 ASR；
- 腾讯云 TTS 合成、IMA-ADPCM 下发、CRC32 校验和 MAX98357A 播放；
- 协议化模拟挂件。

### 语音首响延迟优化

挂件语音链路针对“按下 PTT 到第一次播放”做了以下优化：

- 有效语音后的自动收音等待由 1.2 秒缩短为 0.8 秒；
- 固件录音和 BLE ACK 使用独立状态机，录音产生数据后立即上传，I2S 读取改为非阻塞轮询；
- 挂件 WAV 在内存中直接转为 Base64 上传 ASR，不再先写临时文件再读回；
- ADPCM 在小程序中增量解码，每约 200ms PCM 上传腾讯云实时 ASR；实时连接失败时才回退完整 WAV；
- AI 回复最多取 150 个字符朗读，首段约 16 字符，后续按约 40 个字符自然分段；
- 流式 AI 的首个安全句段到达后立即生成并下发语音，后续句段在第一段播放期间并行预取；
- 流式服务不可用时，第一段语音仍会单独生成，后续段批量并行生成；
- TTS 协议 v2 在约 400ms 预缓冲后开始 I2S 播放，同时继续接收剩余 BLE 分包；
- 协议直接升级到控制版本 `1.3`、Audio/TTS Version `2`，不兼容 v1 开发固件。

真机调试时，小程序控制台会输出 `[VOICE_LATENCY]`，其中包含录音、BLE 上行、ASR、AI、首段 TTS、BLE 下行和“按键到首次播放”的分段耗时。部署后应以该日志确认当前网络或硬件环境中的实际瓶颈。

录音上行见 [云团 BLE 实时录音上传协议 v2](docs/YUNTUAN_BLE_AUDIO_TRANSFER_V0.3.md)，播放下行见 [云团 BLE 边收边播协议 v2](docs/YUNTUAN_BLE_SPEECH_PLAYBACK_V0.4.md)。量产认证和 OTA 仍未实现。

协议测试：

```powershell
node tests\audio_stream_test.js
node tests\realtime_asr_test.js
node tests\tts_edge_playback_test.js
node tests\chat_stream_test.js
node tests\chat_guard_test.js
node tests\chat_cloudfunction_test.js
```

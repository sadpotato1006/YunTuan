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

`chat` 云函数同时提供腾讯云 ASR 与 TTS。TTS 可设置 `TTS_SECRET_ID`、`TTS_SECRET_KEY`、`TTS_SESSION_TOKEN`、`TTS_REGION`、`TTS_VOICE_TYPE`、`TTS_SPEED` 和 `TTS_VOLUME`；未单独设置 TTS 密钥时会复用对应的 `ASR_*` 密钥。部署时必须选择“上传并部署：云端安装依赖”。

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
- 1 秒、3 秒、5 秒退避重连；
- 硬件 PTT 录音经 IMA-ADPCM 上传、重组为 WAV 后调用 ASR；
- 腾讯云 TTS 合成、IMA-ADPCM 下发、CRC32 校验和 MAX98357A 播放；
- 协议化模拟挂件。

播放下行协议见 [云团 BLE 语音合成与硬件播放协议 v0.4](docs/YUNTUAN_BLE_SPEECH_PLAYBACK_V0.4.md)。量产认证和 OTA 仍未实现。

协议测试：

```powershell
node tests\yuntuan_protocol_test.js
node tests\yuntuan_device_integration_test.js
```

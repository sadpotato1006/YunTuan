# 云团微信小程序

“云团”是面向随迁老人的陪伴类产品。本仓库当前提供原生微信小程序前端、Mock 数据以及可部署的微信云函数占位实现，不包含真实 AI、数据库和 BLE 通信。

硬件联调前请先评审 [云团挂件 BLE 通信协议草案 v0.1](docs/YUNTUAN_BLE_PROTOCOL_V0.1.md)。

## 后端模式

在 `miniprogram/config/index.js` 中修改 `backendMode`：

- `mock`：本地 Promise 模拟数据，无需网络、服务器或云开发环境，当前默认模式，适合界面和交互开发。
- `cloud`：由 `wx.cloud.callFunction` 调用微信云函数，适合承载 AI 调用、云数据库和设备绑定数据。
- `http`：由统一封装的 `wx.request` 调用自建服务器，未来可连接 Node.js、Python 或 Java 后端。

页面只调用 `services`，切换模式不需要修改页面。

也可以通过 `serviceBackendModes` 为不同业务单独指定模式。当前项目仅有 `chat`
使用已部署的云函数，`device` 和 `emotion` 在对应云函数部署前继续使用 Mock：

```js
serviceBackendModes: {
  chat: "cloud",
  device: "mock",
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

Mock 模式不会初始化或调用 `wx.cloud`，因此无需创建云环境。当前默认 Mock 是为了让产品原型在未确定服务器和云开发方案前保持零后端依赖。

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

如需语音功能，可由小程序录音并上传云存储，将云文件 ID 传给云函数进行语音识别和 AI 处理。

## 使用自建服务器

购买并部署服务器后：

1. 把 `backendMode` 改为 `http`。
2. 把 `baseUrl` 改为真实 HTTPS API 地址。
3. 在微信公众平台配置服务器域名白名单。
4. 让后端接口与现有 services 中的路径和统一返回结构保持一致。

HTTP 请求由 `miniprogram/utils/request.js` 统一处理成功响应、非 2xx 状态码、业务错误、网络失败和超时。

## BLE 说明

BLE 搜索、连接、断开和数据通信应使用小程序端的微信蓝牙 API。云函数或 HTTP 后端只负责设备绑定关系、用户授权和状态历史等服务端数据。

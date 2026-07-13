# 云团挂件 BLE 通信协议草案 v0.1

> 状态：供产品、小程序、云端和硬件团队评审，尚未冻结。  
> 日期：2026-07-13  
> 适用范围：云团第一代陪伴挂件与微信小程序之间的近距离 BLE 通信。

## 1. 设计目标

本协议用于完成以下功能：

- 发现云团挂件；
- 首次安全绑定；
- 建立连接并验证当前用户；
- 获取设备型号、固件版本和硬件版本；
- 读取和订阅电量；
- 读取、设置社交模式；
- 让设备振动或鸣响，方便寻找挂件；
- 接收设备按键、低电量和状态变化事件；
- 为以后增加功能和固件升级预留兼容空间。

本版本不承载实时音频、AI 对话音频或 OTA 固件数据。实时音频数据量较大，不建议直接复用本控制协议。

## 2. 系统角色

| 角色 | BLE 角色 | 职责 |
| --- | --- | --- |
| 云团挂件 | Peripheral / GATT Server | 广播、保存设备密钥、执行控制指令、上报设备状态 |
| 微信小程序 | Central / GATT Client | 搜索、连接、发现服务、写入控制指令、接收通知 |
| device 云函数 | 非 BLE 参与方 | 验证设备证明、保存 OpenID 与 deviceSn 的绑定关系、签发会话令牌 |

云函数不能直接连接用户身边的蓝牙设备。BLE 通信始终发生在手机与挂件之间。

## 3. 设备标识

### 3.1 设备序列号 deviceSn

使用 16 个大写 ASCII 字符：

```text
YT + 产品代码2位 + 生产年份2位 + 流水号10位
```

示例：

```text
YT01260000000001
```

要求：

- 每台设备全生命周期唯一；
- 烧录后不可普通写入修改；
- 出厂数据库必须保存 deviceSn 与设备密钥的对应关系；
- 小程序和云端把 deviceSn 作为业务主键，不把手机系统返回的 `deviceId` 当作设备永久身份；
- 不在 BLE 广播中暴露完整 deviceSn。

### 3.2 蓝牙广播名称

格式：

```text
YT- + deviceSn 最后6位
```

示例：

```text
YT-000001
```

名称只用于帮助用户识别附近设备，不能用于安全认证。

### 3.3 机身二维码

建议格式：

```text
yuntuan://bind?v=1&sn=YT01260000000001&code=7K4P9M2Q8D6X
```

字段：

| 字段 | 含义 |
| --- | --- |
| `v` | 二维码格式版本 |
| `sn` | deviceSn |
| `code` | 每台设备独立的 12 位随机绑定码，使用易识别的 Base32 字符 |

绑定码不得使用 deviceSn、MAC 地址或固定默认密码推导。云端只保存绑定码的加盐哈希；生产和售后流程需要能够安全补发或重置。

## 4. 广播规范

设备未连接时进行可连接广播。

建议广播内容：

- Flags；
- Shortened/Complete Local Name：`YT-xxxxxx`；
- 云团自定义主 Service UUID；
- 不广播完整 deviceSn、绑定码、用户信息或设备密钥；
- 没有 Bluetooth SIG Company Identifier 时，不伪造 Manufacturer Specific Data 的 Company ID。

建议广播策略：

| 状态 | 建议广播间隔 | 持续时间 |
| --- | --- | --- |
| 用户长按进入绑定模式 | 100～250 ms | 60 秒 |
| 已绑定、等待普通重连 | 500～1000 ms | 由功耗评估决定 |
| 低电量 | 1000～2000 ms | 由功耗评估决定 |

进入绑定模式时，挂件必须通过灯光、振动或提示音给出明确反馈。

## 5. GATT 服务和特征值

### 5.1 标准 Device Information Service

| 项目 | UUID | 属性 | 要求 |
| --- | --- | --- | --- |
| Device Information Service | `0x180A` | Service | 建议实现 |
| Model Number String | `0x2A24` | Read | 必须，例如 `YT-P01` |
| Firmware Revision String | `0x2A26` | Read | 必须，例如 `1.0.0` |
| Hardware Revision String | `0x2A27` | Read | 必须，例如 `A1` |
| Serial Number String | `0x2A25` | Read | 可选；若实现，应要求认证后读取 |

序列号属于固定唯一标识，未认证连接不应随意读取。小程序在首次绑定时以二维码中的 deviceSn 为准。

### 5.2 标准 Battery Service

| 项目 | UUID | 属性 | 要求 |
| --- | --- | --- | --- |
| Battery Service | `0x180F` | Service | 必须 |
| Battery Level | `0x2A19` | Read + Notify | 必须，1 字节无符号整数，范围 0～100 |

设备应在以下场景发送 Battery Level Notify：

- 连接并订阅成功后首次上报；
- 电量相对上次上报变化至少 1%；
- 充电状态导致电量发生变化；
- 电量跨越 20%、10%、5% 阈值。

不建议小程序高频轮询电量。

### 5.3 云团自定义控制服务

自定义 UUID 使用项目自有的 128-bit UUID，不占用 Bluetooth SIG 未授权的 16-bit UUID。

| 项目 | UUID | 属性 | 方向 |
| --- | --- | --- | --- |
| Yuntuan Control Service | `A92B1000-6E3B-4C5D-9F21-4A7C2D8E1B30` | Service | — |
| Command RX | `A92B1001-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write 必须；Write Without Response 可选 | 小程序 → 挂件 |
| Event TX | `A92B1002-6E3B-4C5D-9F21-4A7C2D8E1B30` | Notify 必须；Indicate 可选 | 挂件 → 小程序 |
| Protocol Info | `A92B1003-6E3B-4C5D-9F21-4A7C2D8E1B30` | Read | 挂件 → 小程序 |

`Protocol Info` 固定为 4 字节：

| 偏移 | 长度 | 含义 |
| --- | --- | --- |
| 0 | 1 | 协议主版本，当前为 `1` |
| 1 | 1 | 协议次版本，当前为 `0` |
| 2 | 2 | Capability 位图，uint16，小端 |

Capability：

| Bit | 功能 |
| --- | --- |
| 0 | 标准 Battery Service |
| 1 | 社交模式 |
| 2 | 查找设备振动/鸣响 |
| 3 | 设备按键事件 |
| 4 | 充电状态 |
| 5 | 预留 OTA |
| 6～15 | 保留，发送端必须置 0 |

## 6. 字节序和基础类型

- 多字节整数统一使用小端序；
- 字符串统一使用 UTF-8，不带结尾 `\0`；
- 布尔值：`0x00` 表示 false，`0x01` 表示 true；
- 时间：uint32 Unix 秒；
- 未定义字段不得随意复用；
- 接收端必须忽略不认识的可选 TLV 字段，但不能忽略未知命令。

## 7. 传输帧格式

v0.1 为保证 Android、iOS 和不同芯片兼容，默认按单次最多 20 字节特征值数据设计。后续确认双方支持更大 ATT MTU 后可以提高单片长度，但帧格式不变。

每个 BLE 写入或通知包格式：

| 偏移 | 长度 | 字段 | 说明 |
| --- | --- | --- | --- |
| 0 | 1 | SOF | 固定 `0xA5` |
| 1 | 1 | Version | 固定 `0x01` |
| 2 | 1 | Flags | 帧类型和控制位 |
| 3 | 1 | Command | 命令字 |
| 4 | 1 | Sequence | 请求序号，1～255；0 保留给设备主动事件 |
| 5 | 1 | FragmentIndex | 当前分片，从 0 开始 |
| 6 | 1 | FragmentCount | 总分片数，1～16 |
| 7 | 1 | PayloadLength | 当前分片负载长度 |
| 8 | N | Payload | 当前分片负载 |
| 8+N | 2 | CRC16 | 当前分片 CRC，小端 |

20 字节默认长度下，每片最多携带 10 字节 Payload。v0.1 单个逻辑消息最大 160 字节。

Flags：

| Bit | 含义 |
| --- | --- |
| 0 | `1` 表示 Response |
| 1 | `1` 表示 Event |
| 2 | `1` 表示要求应用层应答 |
| 3 | `1` 表示已通过会话认证 |
| 4～7 | 保留，必须置 0 |

CRC 规则：

- 算法：CRC-16/CCITT-FALSE；
- Polynomial：`0x1021`；
- Init：`0xFFFF`；
- RefIn/RefOut：false；
- XorOut：`0x0000`；
- 计算范围：从 Version 字段到 Payload 最后一个字节，不包括 SOF 和 CRC 自身；
- CRC 在帧中以低字节在前的顺序发送。

BLE 链路本身已有校验，但应用层 CRC 用于发现分片、长度和协议实现错误。

## 8. TLV 负载格式

复杂 Payload 统一使用 TLV：

```text
Type: 1 byte
Length: 1 byte
Value: Length bytes
```

字段定义：

| Type | 名称 | Value |
| --- | --- | --- |
| `0x01` | ProtocolVersion | major 1 字节 + minor 1 字节 |
| `0x02` | DeviceSn | 16 字节 UTF-8 |
| `0x03` | Model | UTF-8，最多 16 字节 |
| `0x04` | FirmwareVersion | UTF-8，最多 16 字节 |
| `0x05` | HardwareVersion | UTF-8，最多 8 字节 |
| `0x06` | Battery | uint8，0～100 |
| `0x07` | ChargingState | 0 未充电，1 充电中，2 已充满，255 未知 |
| `0x08` | SocialMode | 0 关闭，1 开启 |
| `0x09` | BindState | 0 未绑定，1 已绑定，2 绑定模式中 |
| `0x0A` | Capabilities | uint16，小端 |
| `0x0B` | UnixTime | uint32，小端 |
| `0x0C` | Nonce | 16 字节随机数 |
| `0x0D` | Proof | 32 字节 HMAC-SHA256 |
| `0x0E` | AuthToken | 32 字节 HMAC-SHA256 |
| `0x0F` | SessionId | 8 字节随机值 |
| `0x10` | AlertDuration | uint16 毫秒，建议范围 500～10000 |
| `0x11` | AlertType | 0 振动，1 提示音，2 振动+提示音 |
| `0x12` | ButtonEvent | 1 单击，2 双击，3 长按 |
| `0x13` | Uptime | uint32 秒，小端 |

## 9. 命令定义

请求和响应使用相同 Command，Response 通过 Flags bit0 区分，Sequence 必须一致。

| Command | 名称 | 请求 Payload | 成功响应数据 | 是否需要会话认证 |
| --- | --- | --- | --- | --- |
| `0x01` | HELLO | 空 | 协议版本、能力、BindState、Nonce | 否 |
| `0x02` | GET_STATUS | 空 | Battery、ChargingState、SocialMode、Uptime | 读取可不认证 |
| `0x03` | SET_SOCIAL_MODE | SocialMode | SocialMode | 是 |
| `0x04` | FIND_DEVICE | AlertType、AlertDuration | 空 | 是 |
| `0x05` | SET_TIME | UnixTime | UnixTime | 是 |
| `0x10` | BIND_BEGIN | SessionId、Nonce | DeviceSn、Proof | 绑定模式中可用 |
| `0x11` | BIND_COMMIT | SessionId、AuthToken | BindState | 绑定模式中可用 |
| `0x12` | SESSION_AUTH | SessionId、Nonce、AuthToken | BindState | 已绑定设备可用 |
| `0x13` | UNBIND | SessionId、AuthToken | BindState | 是，并要求设备实体确认 |

设备主动事件：

| Command | 名称 | Payload |
| --- | --- | --- |
| `0x20` | STATUS_CHANGED | Battery、ChargingState、SocialMode 中发生变化的字段 |
| `0x21` | BUTTON_EVENT | ButtonEvent、UnixTime |
| `0x22` | LOW_BATTERY | Battery |
| `0x23` | BIND_WINDOW_CHANGED | BindState |

事件帧 Sequence 固定为 0，Flags bit1 为 1。

## 10. 统一响应格式和错误码

所有 Response 的 Payload 前两个字节固定为 uint16 StatusCode，小端；只有 StatusCode 为 0 时才继续解析后续 TLV。

| 状态码 | 名称 | 含义 |
| --- | --- | --- |
| `0x0000` | OK | 成功 |
| `0x0001` | UNKNOWN_COMMAND | 未知命令 |
| `0x0002` | INVALID_PAYLOAD | 长度或字段错误 |
| `0x0003` | BUSY | 设备忙 |
| `0x0004` | UNAUTHORIZED | 未完成会话认证 |
| `0x0005` | NOT_IN_BIND_MODE | 不在绑定窗口 |
| `0x0006` | NOT_SUPPORTED | 当前固件不支持 |
| `0x0007` | INTERNAL_ERROR | 设备内部错误 |
| `0x0008` | CRC_ERROR | CRC 校验失败 |
| `0x0009` | FRAGMENT_ERROR | 分片缺失、重复或顺序错误 |
| `0x000A` | LOW_BATTERY | 电量过低，拒绝当前操作 |
| `0x000B` | ALREADY_BOUND | 设备已绑定 |
| `0x000C` | BIND_CONFLICT | 设备属于其他账号 |
| `0x000D` | VERSION_INCOMPATIBLE | 协议主版本不兼容 |
| `0x000E` | AUTH_FAILED | Proof 或 AuthToken 验证失败 |
| `0x000F` | PHYSICAL_CONFIRM_REQUIRED | 需要实体按键确认 |

## 11. 首次绑定流程

### 11.1 出厂准备

每台设备生成：

- 唯一 deviceSn；
- 32 字节真随机 `K_device`；
- 12 位随机绑定码；
- 机身二维码。

硬件安全区保存 deviceSn、`K_device` 和绑定状态。云端生产库保存 deviceSn、加密后的 `K_device`、绑定码加盐哈希、型号和批次。

不同设备禁止共用同一个 `K_device`。

### 11.2 用户操作

1. 用户在小程序扫描机身二维码；
2. 用户长按设备按键 3 秒；
3. 设备振动一次并进入 60 秒绑定窗口；
4. 小程序按照名称后 6 位和二维码 deviceSn 后 6 位筛选设备；
5. 建立 BLE 连接；
6. 获取服务和特征值；
7. 先订阅 Event TX 和 Battery Level Notify；
8. 读取 Protocol Info，检查主版本；
9. 调用 device 云函数 `createBindChallenge`，提交 deviceSn 和二维码绑定码；
10. 云函数校验绑定码后返回 8 字节 SessionId 和 16 字节 Nonce；
11. 小程序发送 `BIND_BEGIN`；
12. 设备返回：

```text
Proof = HMAC-SHA256(
  K_device,
  "BIND" || deviceSn || SessionId || Nonce
)
```

13. 小程序把 Proof 交给云函数；
14. 云函数验证成功后保存 OpenID 与 deviceSn 的绑定关系，并返回：

```text
AuthToken = HMAC-SHA256(
  K_device,
  "COMMIT" || deviceSn || SessionId || Nonce || OwnerIdHash
)
```

15. 小程序发送 `BIND_COMMIT`；
16. 设备验证 AuthToken，写入已绑定状态和 OwnerIdHash；
17. 设备返回 OK，小程序显示绑定成功。

绑定过程中任意一步失败，小程序必须关闭连接并允许用户重新操作。绑定码、设备密钥、完整 AuthToken 不写入日志。

## 12. 后续连接认证

已绑定设备每次 BLE 连接后：

1. 小程序发送 HELLO；
2. 设备生成新的 16 字节连接 Nonce；
3. 小程序将 deviceSn、Nonce 交给 device 云函数；
4. 云函数确认当前 OpenID 是设备所有者；
5. 云函数签发短期 Session AuthToken；
6. 小程序发送 `SESSION_AUTH`；
7. 设备验证成功后，仅对当前 BLE 连接开放写控制权限；
8. 连接断开后立即清除会话认证状态。

未认证连接允许读取电量和非敏感版本信息，但不得设置社交模式、触发振动或解绑。

如果产品要求无网络时也能控制设备，需要另行评审离线令牌方案；v0.1 不缓存长期控制密钥到小程序。

## 13. 解绑流程

为了避免远处或误触解绑，必须同时满足：

- 当前微信用户是云端记录的设备所有者；
- 当前 BLE 会话已认证；
- 用户在 30 秒内长按设备实体按键 5 秒确认；
- 云函数签发一次性 UNBIND AuthToken。

解绑完成后：

- 设备清除 OwnerIdHash 和绑定状态，但保留 deviceSn、K_device、生产信息；
- 云函数删除或标记失效绑定关系并保留必要审计记录；
- 设备重新进入 60 秒绑定窗口；
- 不允许仅通过普通 BLE 写入直接恢复出厂设置。

## 14. 超时、重试和幂等

| 操作 | 超时 | 重试 |
| --- | --- | --- |
| 搜索目标设备 | 10 秒 | 用户主动重试 |
| 建立连接 | 8 秒 | 自动 1 次 |
| 普通命令响应 | 2 秒 | 最多 2 次 |
| 绑定/认证命令响应 | 5 秒 | 最多 1 次 |
| 分片等待 | 2 秒 | 整条消息重发 |

规则：

- v0.1 同时只允许一个未完成请求；
- 重试必须复用相同 Sequence；
- 设备缓存最近 16 个 Sequence 的执行结果至少 30 秒；
- 收到重复 Sequence 时返回缓存结果，不重复执行振动、解绑等有副作用操作；
- 小程序在订阅 Event TX 成功前不得发送业务命令；
- 主动断开必须调用关闭连接；意外断线后按 1 秒、3 秒、5 秒退避重连，三次失败后停止。

## 15. 状态同步规则

- BLE 连接成功不等于设备绑定成功；
- 写特征值成功不等于设备执行成功，必须等待相同 Sequence 的应用层 Response；
- 页面状态以设备确认响应或 STATUS_CHANGED 事件为准；
- 小程序每次连接、从后台恢复或重连成功后调用 GET_STATUS；
- 正常连接期间依靠 Notify 更新状态，不高频轮询；
- 设备断开时，小程序显示“设备已绑定，当前未连接”，不能误显示为“未绑定”。

建议小程序状态机：

```text
IDLE
  → SCANNING
  → CONNECTING
  → DISCOVERING_SERVICES
  → SUBSCRIBING
  → AUTHENTICATING
  → READY
  → RECONNECTING / ERROR
```

## 16. 协议兼容策略

- 主版本不同：视为不兼容，停止控制并提示升级小程序或设备固件；
- 主版本相同、设备次版本更高：小程序忽略未知 TLV；
- 未知命令：设备返回 `UNKNOWN_COMMAND`；
- 新增字段优先增加新 TLV，不改变已有字段含义；
- Capability 未声明的功能，小程序不得调用；
- 所有保留位发送时必须为 0，接收时忽略；
- OTA 另行制定独立协议，不直接塞入本控制协议。

## 17. 安全和隐私要求

- 每台设备使用独立随机密钥；
- 设备密钥不得出现在二维码、广播、小程序源码或普通日志中；
- 广播不包含完整 deviceSn、用户标识和绑定码；
- 不使用设备名称、MAC、deviceId 作为认证凭据；
- 云端设备密钥应加密存储，并限制只有绑定校验逻辑可以使用；
- 所有 Nonce 必须由安全随机数生成器产生，不得使用时间戳代替；
- AuthToken 只能用于指定设备、指定 SessionId、指定 Nonce 和指定动作；
- 设备收到连续 5 次认证失败后，当前连接锁定 30 秒；
- 小程序不保存 `K_device`；
- 设备实体确认是首次绑定、解绑和恢复出厂设置的必要条件；
- 固件量产前应启用读保护、安全启动和固件签名能力（若芯片支持）。

## 18. 小程序代码映射建议

```text
miniprogram/
├── config/ble.js             UUID、超时和协议版本
├── utils/ble.js              wx.openBluetoothAdapter 等底层 Promise 封装
├── utils/buffer.js           ArrayBuffer、TLV、CRC、分片编解码
├── services/ble.js           扫描、连接、订阅、认证、重连状态机
├── services/device.js        页面唯一调用入口
└── pages/device/             展示和用户操作，不直接调用 wx BLE API
```

建议 `deviceService` 最终提供：

```js
discoverDevices()
bindDevice(deviceId, qrPayload)
connectBoundDevice()
disconnectDevice()
getDeviceStatus()
setSocialMode(enabled)
findDevice()
unbindDevice()
```

device 云函数建议提供：

```text
createBindChallenge
verifyBindProof
createSessionToken
createUnbindToken
getBinding
```

## 19. 联调和验收用例

硬件和小程序至少共同通过以下用例：

| 编号 | 用例 | 预期结果 |
| --- | --- | --- |
| T01 | 未按实体键直接绑定 | 返回 NOT_IN_BIND_MODE |
| T02 | 正确二维码和正确设备绑定 | 云端、设备、小程序三方状态一致 |
| T03 | 二维码与附近设备不匹配 | 拒绝绑定 |
| T04 | 错误绑定码 | 云端拒绝，不向设备提交绑定 |
| T05 | 重放旧 Proof | 云端拒绝 |
| T06 | 已绑定设备被其他账号绑定 | 返回 BIND_CONFLICT |
| T07 | 读取电量 | 0～100，页面一致 |
| T08 | 电量跨过 20% | 收到低电量事件 |
| T09 | 设置社交模式 | 等待设备响应后更新页面 |
| T10 | 重复发送相同 Sequence | 设备不重复执行副作用 |
| T11 | 分片缺失或 CRC 错误 | 返回对应错误，不执行命令 |
| T12 | BLE 中途断开 | 页面更新状态，有限次数重连 |
| T13 | 手机蓝牙关闭 | 显示明确引导，不崩溃 |
| T14 | Android 真机绑定与重连 | 通过 |
| T15 | iPhone 真机绑定与重连 | 通过 |
| T16 | 清除小程序缓存后重连 | 通过云端绑定关系恢复 |
| T17 | 合法解绑 | 设备和云端均解除关系 |
| T18 | 未实体确认解绑 | 拒绝解绑 |

## 20. 评审时必须确认的问题

以下问题需要硬件、小程序、云端和产品共同确认后才能冻结 v1.0：

1. MCU 和 BLE 芯片型号，是否支持 HMAC-SHA256、安全随机数、Flash 安全区；
2. 是否有实体按键、指示灯、振动马达和蜂鸣器；
3. 实体按键进入绑定和解绑的具体交互；
4. 是否接受每台设备独立密钥和生产数据库灌装流程；
5. 微信小程序无网络时是否必须允许控制设备；
6. 是否实现标准 Device Information Service 和 Battery Service；
7. 设备低功耗目标、广播间隔和连接参数；
8. 默认 ATT MTU 和双方最大支持值；
9. 社交模式在硬件上的准确含义、开启条件和关闭条件；
10. 按键事件最终有哪些类型和业务含义；
11. 是否需要“查找设备”振动/鸣响功能；
12. OTA 是否需要在第一代产品支持；
13. 量产二维码、绑定码、设备密钥由谁生成和管理；
14. 售后换机、转赠、丢失、强制解绑的处理流程；
15. 是否申请 Bluetooth SIG Company Identifier；未申请前不得伪造。

## 21. 推荐的第一阶段实现范围

第一轮硬件联调只实现最小闭环：

1. 广播和搜索；
2. 连接与服务发现；
3. Protocol Info；
4. Battery Service；
5. HELLO、GET_STATUS；
6. SET_SOCIAL_MODE；
7. 简化但保留接口结构的绑定挑战；
8. 断线监听和手动重连。

验证稳定后再加入完整云端认证、查找设备、解绑、按键事件和 OTA。

## 22. 规范参考

- [Bluetooth SIG：Generic Attribute Profile (GATT)](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-61/out/en/host/generic-attribute-profile--gatt-.html)
- [Bluetooth SIG：Attribute Protocol (ATT)](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-62/out/en/host/attribute-protocol--att-.html)
- [Bluetooth SIG：Battery Service 1.1](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/BAS_v1.1/out/en/index-en.html)
- [Bluetooth SIG：Device Information Service 1.2](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/DIS_v1.2/out/en/index-en.html)
- [Bluetooth SIG：Assigned Numbers](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Assigned_Numbers/out/en/index-en.html)
- [微信小程序：Bluetooth API](https://developers.weixin.qq.com/miniprogram/dev/api/device/bluetooth/wx.openBluetoothAdapter.html)
- [微信小程序：BLE API](https://developers.weixin.qq.com/miniprogram/dev/api/device/bluetooth-ble/wx.createBLEConnection.html)

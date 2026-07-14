# 云团挂件软硬件 BLE 通信规范 v0.2

> 文档性质：小程序与挂件固件之间的 BLE 联调接口说明  
> 兼容基线：`YUNTUAN_BLE_PROTOCOL_REVIEW_V0.2.md` 与当前小程序实现  
> 适用阶段：实验室联调，`SecurityMode=0`

## 1. 范围

本文只定义以下两端之间的 BLE 通信：

| 端 | BLE 角色 | 职责 |
| --- | --- | --- |
| 微信小程序 | Central / GATT Client | 扫描、连接、发现服务、读写特征值、订阅通知 |
| 云团挂件 | Peripheral / GATT Server | 广播、提供 GATT 服务、执行命令、发送响应和事件 |

本文不定义云函数、AI 服务、用户账户、设备所有权、生产密钥、二维码绑定和 OTA 数据传输。`BindState` 和 `SecurityMode` 仅保留现有协议字段，不在本文扩展认证流程。

文中“必须”“不得”为兼容当前小程序的强制要求；“建议”“可选”为不影响当前基础联调的要求。

## 2. 兼容性总览

挂件要完整通过当前小程序初始化，必须满足：

1. 发送可连接 BLE 广播；
2. 广播名称以 `YT-` 开头；
3. 广播中包含 Yuntuan Control Service UUID；
4. 提供本文规定的必需 GATT 服务和特征值；
5. Protocol Info 可读且固定为 6 字节；
6. Event TX 可订阅；
7. Command RX 支持有响应写入 `Write`；
8. 正确响应 `HELLO` 和 `GET_STATUS`；
9. 响应帧的 Command、Sequence、长度和 CRC 正确；
10. 普通命令在 2 秒内响应。

搜索成功只说明广播条件满足；BLE 连接成功只说明链路已建立。完成全部初始化并进入 `READY` 才表示软硬件协议兼容。

## 3. 广播与扫描

### 3.1 广播名称

广播名称格式：

```text
YT- + deviceSn 最后 6 位
```

示例：

```text
YT-000001
```

名称只用于扫描结果筛选和页面展示，不作为认证凭据。

### 3.2 必需广播内容

挂件未连接时必须发送可连接广播，至少包含：

- Flags；
- Yuntuan Control Service UUID；
- Complete Local Name 或 Shortened Local Name，且以 `YT-` 开头。

标准 Battery Service UUID 可以广播，但不参与当前正式设备页的扫描条件。

当前正式设备页唯一使用的 UUID 扫描条件是：

```text
A92B1000-6E3B-4C5D-9F21-4A7C2D8E1B30
```

如果使用传统 31 字节广播，建议主广播包放 Flags 和 128-bit Control Service UUID，扫描响应包放完整名称。

### 3.3 广播行为

| 状态 | 建议广播间隔 | 行为 |
| --- | --- | --- |
| 实验室联调 | 100～250 ms | 持续发送可连接广播 |
| 已连接 | — | 停止可连接广播 |
| 意外断开 | — | 1 秒内恢复广播 |

不得在广播中发送完整设备序列号、用户信息、密钥或绑定码。

## 4. GATT 服务

标准 16-bit UUID 可以由协议栈显示为完整 Bluetooth Base UUID。小程序比较 UUID 时忽略连字符和大小写。

### 4.1 Device Information Service

| 项目 | UUID | 属性 | 要求 |
| --- | --- | --- | --- |
| Device Information Service | `0000180A-0000-1000-8000-00805F9B34FB` | Service | 必须 |
| Model Number String | `00002A24-0000-1000-8000-00805F9B34FB` | Read | 必须 |
| Serial Number String | `00002A25-0000-1000-8000-00805F9B34FB` | Read | 可选 |
| Firmware Revision String | `00002A26-0000-1000-8000-00805F9B34FB` | Read | 必须 |
| Hardware Revision String | `00002A27-0000-1000-8000-00805F9B34FB` | Read | 必须 |

字符串使用 UTF-8，不带结尾 `\0`。建议值：

```text
Model Number: YT-P01
Firmware Revision: 0.2.0
Hardware Revision: A1
```

如果提供 Serial Number，当前小程序会读取它，因此该特征值必须真实支持 Read。

### 4.2 Battery Service

| 项目 | UUID | 属性 | 要求 |
| --- | --- | --- | --- |
| Battery Service | `0000180F-0000-1000-8000-00805F9B34FB` | Service | 必须 |
| Battery Level | `00002A19-0000-1000-8000-00805F9B34FB` | Read + Notify | 必须 |

Battery Level 固定为 1 字节无符号整数，合法范围为 `0～100`。小程序连接时会先订阅，再主动读取一次。

建议在以下时机发送 Battery Level Notify：

- 订阅成功后；
- 电量变化至少 1%；
- 跨越 20%、10%、5% 阈值；
- 充电状态变化并导致电量变化。

### 4.3 Yuntuan Control Service

| 项目 | UUID | 属性 | 方向 | 要求 |
| --- | --- | --- | --- | --- |
| Yuntuan Control Service | `A92B1000-6E3B-4C5D-9F21-4A7C2D8E1B30` | Service | — | 必须 |
| Command RX | `A92B1001-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write；Write Without Response 可选 | 小程序 → 挂件 | 必须 |
| Event TX | `A92B1002-6E3B-4C5D-9F21-4A7C2D8E1B30` | Notify；Indicate 可选 | 挂件 → 小程序 | 必须 |
| Protocol Info | `A92B1003-6E3B-4C5D-9F21-4A7C2D8E1B30` | Read | 挂件 → 小程序 | 必须 |

兼容要求：

- 当前小程序向 Command RX 明确使用 `Write`，只实现 Write Without Response 不兼容；
- 所有命令响应和主动事件必须从 Event TX 返回；
- 小程序订阅 Event TX 后才发送业务命令；
- Command RX 和 Event TX 传输的值必须是第 7 节定义的完整应用层帧。

## 5. Protocol Info

Protocol Info 特征值固定返回 6 字节：

| 偏移 | 长度 | 字段 | 当前要求 |
| ---: | ---: | --- | --- |
| 0 | 1 | ProtocolMajor | `0x01` |
| 1 | 1 | ProtocolMinor | `0x00` |
| 2 | 2 | Capabilities | uint16，小端 |
| 4 | 1 | SecurityMode | 实验室模式为 `0x00` |
| 5 | 1 | Reserved | 固定 `0x00` |

Capabilities：

| Bit | 值 | 功能 |
| ---: | ---: | --- |
| 0 | `0x0001` | Battery Service |
| 1 | `0x0002` | 社交模式 |
| 2 | `0x0004` | 查找设备 |
| 3 | `0x0008` | 设备按键事件 |
| 4 | `0x0010` | 充电状态 |
| 5 | `0x0020` | 设备时间同步 |
| 6 | `0x0040` | 量产会话认证 |
| 7 | `0x0080` | OTA，当前阶段不得置 1 |
| 8～15 | — | 保留，必须置 0 |

基础联调示例：

```text
01 00 1F 00 00 00
```

表示协议版本 1.0，支持电量、社交模式、查找、按键和充电状态，使用实验室安全模式。

当前小程序会强制检查长度为 6、ProtocolMajor 为 1、Reserved 为 0。ProtocolMinor 和 Capabilities 会被读取并保存；设备不得声明尚未实现的能力。

## 6. 基础编码规则

- 多字节整数使用小端序；
- 字符串使用 UTF-8，不带结尾 `\0`；
- 布尔值只允许 `0x00=false` 或 `0x01=true`；
- 时间使用 uint32 Unix 秒；
- 所有保留位和保留字节发送时必须为 0；
- 设备必须先校验长度、范围、帧类型和 CRC，再执行命令；
- 当前应用 Payload 最大 10 字节，不支持分片。

## 7. 应用层数据帧

### 7.1 帧结构

每次 Command RX 写入和 Event TX 通知都使用以下格式：

| 偏移 | 长度 | 字段 | 说明 |
| ---: | ---: | --- | --- |
| 0 | 1 | SOF | 固定 `0xA5` |
| 1 | 1 | Version | 固定 `0x01` |
| 2 | 1 | Flags | 帧类型 |
| 3 | 1 | Command | 命令字 |
| 4 | 1 | Sequence | 请求序号 |
| 5 | 1 | FragmentIndex | 当前固定 `0x00` |
| 6 | 1 | FragmentCount | 当前固定 `0x01` |
| 7 | 1 | PayloadLength | `0～10` |
| 8 | N | Payload | 命令数据 |
| 8+N | 2 | CRC16 | 小端，低字节在前 |

完整帧长度必须等于：

```text
10 + PayloadLength
```

完整帧最大 20 字节。当前版本不得发送分片帧或超长 Payload。

### 7.2 Flags

| Bit | 含义 |
| ---: | --- |
| 0 | Response |
| 1 | 设备主动 Event |
| 2 | 保留，固定 0 |
| 3 | 已完成量产认证 |
| 4～7 | 保留，固定 0 |

实验室模式合法值：

| 帧类型 | Flags |
| --- | ---: |
| 小程序请求 | `0x00` |
| 设备响应 | `0x01` |
| 设备主动事件 | `0x02` |

Response 与 Event 不得同时置 1。

### 7.3 Sequence

- 小程序请求使用 `1～255`；
- 递增到 255 后回到 1；
- 响应必须原样复制请求的 Command 和 Sequence；
- 主动事件的 Sequence 固定为 0；
- 同一时刻最多存在一个未完成请求；
- 同一业务请求重试时继续使用原 Sequence。

小程序只会完成 Command 和 Sequence 同时匹配的待处理请求。设备从 Event TX 发出了数据但 Command 或 Sequence 不匹配时，小程序仍会等待并最终超时。

### 7.4 CRC

使用 CRC-16/CCITT-FALSE：

| 参数 | 值 |
| --- | --- |
| Polynomial | `0x1021` |
| Init | `0xFFFF` |
| RefIn / RefOut | false / false |
| XorOut | `0x0000` |

CRC 计算范围从 Version 到 Payload 最后一个字节，不包含 SOF 和 CRC 字段。CRC 在线路中低字节在前。

GET_STATUS 请求示例，Sequence=`0x01`：

```text
A5 01 00 02 01 00 01 00 A9 48
```

## 8. 通用响应

所有 Response 的 Payload 结构为：

| 偏移 | 长度 | 字段 |
| ---: | ---: | --- |
| 0 | 2 | StatusCode，uint16 小端 |
| 2 | N | 成功响应附加数据 |

只有 StatusCode=`0x0000` 时才携带成功响应附加数据。错误响应不携带附加数据。

| 状态码 | 名称 | 含义 |
| --- | --- | --- |
| `0x0000` | OK | 成功 |
| `0x0001` | UNKNOWN_COMMAND | 未知命令 |
| `0x0002` | INVALID_PAYLOAD | 长度或取值错误 |
| `0x0003` | BUSY | 设备忙 |
| `0x0004` | UNAUTHORIZED | 当前连接未认证 |
| `0x0005` | NOT_SUPPORTED | 硬件或固件不支持 |
| `0x0006` | INTERNAL_ERROR | 设备内部错误 |
| `0x0007` | CRC_ERROR | CRC 校验失败 |
| `0x0008` | VERSION_INCOMPATIBLE | 协议版本不兼容 |
| `0x0009` | LOW_BATTERY | 电量过低，拒绝操作 |
| `0x000A` | PHYSICAL_CONFIRM_REQUIRED | 需要实体确认 |

若 SOF、长度或 CRC 错误导致 Command 和 Sequence 无法可靠获得，设备可以直接丢弃。若能够可靠识别请求，建议返回对应错误响应。

## 9. 命令

### 9.1 命令总表

下表“成功响应数据”不包含前置的 2 字节 StatusCode。

| Command | 名称 | 请求数据长度 | 成功响应数据长度 | 当前要求 |
| ---: | --- | ---: | ---: | --- |
| `0x01` | HELLO | 0 | 6 | 必须 |
| `0x02` | GET_STATUS | 0 | 7 | 必须 |
| `0x03` | SET_SOCIAL_MODE | 1 | 1 | 必须 |
| `0x04` | FIND_DEVICE | 3 | 0 | 有输出器件时必须 |
| `0x05` | SET_TIME | 4 | 0 | 建议 |
| `0x06` | PING | 4 | 4 | 必须 |
| `0x10～0x1F` | 认证命令 | 未定义 | 未定义 | 保留，不得使用 |

### 9.2 HELLO `0x01`

请求数据为空。

成功响应数据固定为 6 字节：

| 偏移 | 长度 | 字段 |
| ---: | ---: | --- |
| 0 | 1 | ProtocolMajor |
| 1 | 1 | ProtocolMinor |
| 2 | 2 | Capabilities，uint16 小端 |
| 4 | 1 | SecurityMode |
| 5 | 1 | BindState：0 未绑定；1 已绑定；2 绑定模式中 |

HELLO 返回的版本、能力和安全模式必须与 Protocol Info 一致。当前小程序再次校验 ProtocolMajor。

成功响应的完整 Payload 长度为 8：2 字节 StatusCode 加 6 字节数据。

### 9.3 GET_STATUS `0x02`

请求数据为空。

成功响应数据固定为 7 字节：

| 偏移 | 长度 | 字段 | 合法值 |
| ---: | ---: | --- | --- |
| 0 | 1 | Battery | `0～100`；无法获取为 `0xFF` |
| 1 | 1 | ChargingState | 0 未充电；1 充电中；2 已充满；255 未知 |
| 2 | 1 | SocialMode | 0 关闭；1 开启 |
| 3 | 4 | Uptime | uint32 秒，小端 |

成功响应的完整 Payload 长度为 9。

### 9.4 SET_SOCIAL_MODE `0x03`

请求数据固定为 1 字节：

| 值 | 含义 |
| ---: | --- |
| `0x00` | 关闭 |
| `0x01` | 开启 |

成功响应数据固定为 1 字节，返回设备实际生效的 SocialMode。设备必须先完成实际状态变更，再返回成功。

开启社交模式请求与响应示例，Sequence=`0x02`：

```text
请求：A5 01 00 03 02 00 01 01 01 AE E8
响应：A5 01 01 03 02 00 01 03 00 00 01 65 EC
```

### 9.5 FIND_DEVICE `0x04`

请求数据固定为 3 字节：

| 偏移 | 长度 | 字段 | 合法值 |
| ---: | ---: | --- | --- |
| 0 | 1 | AlertType | 0 振动；1 提示音；2 振动和提示音 |
| 1 | 2 | Duration | uint16 毫秒，小端，500～10000 |

成功响应无附加数据。设备收到重复 Sequence 时不得重复触发振动或提示音。

### 9.6 SET_TIME `0x05`

请求数据固定为 4 字节 UnixTime，uint32 小端。成功响应无附加数据。不支持时关闭对应 Capability 位并返回 NOT_SUPPORTED。

### 9.7 PING `0x06`

请求数据固定为 4 字节随机值，成功响应必须原样返回相同 4 字节。PING 不改变设备状态。

## 10. 设备主动事件

主动事件必须满足：

- 从 Event TX 发送；
- Flags=`0x02`；
- Sequence=`0x00`；
- 使用正常帧结构和 CRC；
- 不要求小程序返回应用层响应。

| Command | 名称 | Payload 长度 | Payload |
| ---: | --- | ---: | --- |
| `0x20` | STATUS_CHANGED | 3 | Battery、ChargingState、SocialMode |
| `0x21` | BUTTON_EVENT | 5 | ButtonType、UnixTime uint32 小端 |
| `0x22` | LOW_BATTERY | 1 | Battery，0～100 |
| `0x23` | BIND_WINDOW_CHANGED | 1 | BindState：0～2，可选 |

ButtonType：

| 值 | 含义 |
| ---: | --- |
| 1 | 单击 |
| 2 | 双击 |
| 3 | 长按 |

设备时间未知时，BUTTON_EVENT 的 UnixTime 允许为 0。

## 11. 当前小程序连接流程

当前正式设备页按以下顺序执行：

```text
打开蓝牙适配器
  → 按 Control Service UUID 扫描
  → 按 YT- 名称筛选结果
  → 用户选择设备
  → 停止扫描
  → 建立 BLE 连接
  → 发现全部 GATT Service 和 Characteristic
  → 检查必需 GATT 结构
  → 订阅 Event TX
  → 订阅 Battery Level
  → 读取 Protocol Info
  → 校验 Protocol Info 长度、主版本和 Reserved
  → 读取 Model Number
  → 读取 Firmware Revision
  → 读取 Hardware Revision
  → 如果存在则读取 Serial Number
  → 读取 Battery Level
  → 发送 HELLO 并等待匹配响应
  → 发送 GET_STATUS 并等待匹配响应
  → READY
```

任一步失败，小程序会将本次初始化判定为失败并主动断开。

### 11.1 GATT 结构检查

进入协议初始化前必须找到：

- Battery Service / Battery Level；
- Device Information Service / Model Number；
- Device Information Service / Firmware Revision；
- Device Information Service / Hardware Revision；
- Control Service / Command RX；
- Control Service / Event TX；
- Control Service / Protocol Info。

Serial Number 是唯一可缺省的已定义设备信息特征值。

### 11.2 操作能力检查

UUID 存在后，小程序还会通过实际操作继续检查：

- Event TX 支持 Notify 或 Indicate；
- Battery Level 支持 Notify 或 Indicate；
- Protocol Info、设备信息和 Battery Level 支持 Read；
- Command RX 支持 Write；
- Event TX 能返回可解析且匹配的 Response。

## 12. 超时、重试与断线

| 操作 | 当前小程序行为 |
| --- | --- |
| 扫描 | 10 秒后自动停止 |
| 建立连接 | 8 秒超时 |
| 单次特征值读取等待 | 2 秒 |
| 普通命令响应 | 每次等待 2 秒，超时后最多重试 2 次 |
| FIND_DEVICE | 每次等待 3 秒，超时后最多重试 1 次 |
| 意外断线重连 | 1 秒、3 秒、5 秒退避，最多 3 次 |

命令重试必须满足：

- 同一请求重试使用相同 Command 和 Sequence；
- 建议设备缓存最近 16 个 Sequence 的响应至少 30 秒；
- 重复 Sequence 返回缓存响应，不重复执行副作用；
- 收到新请求前完成或拒绝当前请求；
- 响应应明显快于 2 秒上限。

“等待设备响应超时”表示 Command RX 写入已发出，但小程序没有在时限内从 Event TX 收到 Command 和 Sequence 同时匹配的合法 Response。无通知、错误特征值、错误 Flags、错误 Command、错误 Sequence、错误长度或错误 CRC 都可能最终表现为该超时。

## 13. 状态一致性

- BLE 写接口成功只表示数据进入 BLE 协议栈，不表示设备已执行；
- 小程序只依据匹配 Sequence 的成功响应或合法主动事件更新业务状态；
- SET_SOCIAL_MODE 必须返回实际生效值；
- 设备重启或重新连接后，小程序重新读取状态；
- 正常连接期间依靠 Notify 更新，不要求高频轮询；
- 不支持的功能应关闭 Capability 位并返回 NOT_SUPPORTED。

## 14. 联调日志

双方日志至少记录：

- 时间和连接状态；
- Service 与 Characteristic UUID；
- TX/RX 方向；
- Command、Sequence、Flags、StatusCode；
- 完整 HEX 帧；
- 长度、CRC、订阅和超时错误。

不得记录设备密钥、绑定码、完整认证令牌或用户信息。

定位命令超时时：

- 只有 TX、没有 RX：优先检查 Command RX 回调和 Event TX Notify；
- 有 RX 但仍超时：优先检查 Response Flags、Command、Sequence、长度和 CRC；
- 连续三次相同 TX：普通命令已执行初次请求和两次重试；
- TX 第 4 字节为 `01`：HELLO；为 `02`：GET_STATUS。

## 15. 最小联调验收

| 编号 | 检查项 | 通过条件 |
| --- | --- | --- |
| B01 | Android 扫描 | 10 秒内发现 `YT-` 设备 |
| B02 | iPhone 扫描 | 10 秒内发现 `YT-` 设备 |
| B03 | 广播 UUID | 广播中包含 Control Service UUID |
| B04 | GATT 发现 | 找到全部必需服务和特征值 |
| B05 | Protocol Info | 返回 6 字节，主版本 1，Reserved 0 |
| B06 | 标准信息读取 | 型号、固件、硬件字符串可读 |
| B07 | Battery Level | 可读、可订阅，值为 0～100 |
| B08 | HELLO | 2 秒内返回匹配 Command/Sequence 的合法响应 |
| B09 | GET_STATUS | 返回 7 字节状态数据 |
| B10 | SET_SOCIAL_MODE | 实际执行后返回实际状态 |
| B11 | FIND_DEVICE | 输出类型及时长符合请求，不重复执行重试帧 |
| B12 | PING | 原样返回 4 字节随机值 |
| B13 | 主动事件 | Event TX 帧类型、Sequence、长度和 CRC 正确 |
| B14 | 错误 CRC | 不执行命令，丢弃或返回 CRC_ERROR |
| B15 | 错误 Payload | 不执行命令，返回 INVALID_PAYLOAD |
| B16 | 断线恢复 | 1 秒内恢复广播，小程序可重新连接 |

## 16. 版本规则

- ProtocolMajor 不同：停止业务通信；
- ProtocolMajor 相同且设备 ProtocolMinor 更高：只使用当前已知命令和字段；
- 未知命令返回 UNKNOWN_COMMAND；
- 已定义字段不得改变原含义；
- 新功能使用新命令字或新协议版本，不复用保留位；
- 协议变更必须同步更新协议文档、固件版本和小程序实现。

## 17. 兼容性依据

本文不创建新的协议规则，内容来自并兼容：

- `docs/YUNTUAN_BLE_PROTOCOL_REVIEW_V0.2.md`；
- `miniprogram/config/ble.js`；
- `miniprogram/utils/yuntuan-protocol.js`；
- `miniprogram/services/ble.js`；
- `miniprogram/services/yuntuan-device.js`；
- `miniprogram/mock/ble.js`。

若本文与当前小程序实现产生差异，应先停止联调并同步修订两端，禁止任意一端私自改变已冻结字段。

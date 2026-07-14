# 云团 BLE 语音合成与硬件播放协议 v0.4

本文只描述“云团回复文字 → 腾讯云 TTS → BLE → ESP32 扬声器”的软硬件通信，兼容现有 Control Service 与 Audio Upload v0.3。

## 1. 整体链路

1. 小程序从 `chat` 云函数取得 AI 回复文字。
2. 小程序再次调用 `chat` 云函数，`action=synthesize`。
3. 云函数调用腾讯云基础语音合成，要求 16kHz、16bit、单声道 PCM。
4. 云函数将 PCM 编码为 IMA-ADPCM，返回压缩数据、样本数和 CRC32。
5. 小程序通过 Speech Playback Service 分包下发。
6. ESP32 完整接收并校验 CRC32，然后逐样本解码，经 I2S 和 MAX98357A 播放。

密钥只能保存在云函数环境变量中，不得写入小程序或 ESP32。

## 2. 兼容性声明

- Control Service、Battery Service、Device Information Service UUID 不变。
- 上行录音 `A92B200x` UUID、包格式和行为不变。
- Protocol Info 仍严格为 6 字节。
- 协议版本升级为 `1.2`。
- Capability bit 8：`AudioUpload`。
- Capability bit 9：`AudioPlayback`。
- 固件没有 bit 9 时，小程序不请求 TTS，也不检查播放服务。

## 3. Speech Playback GATT

| 名称 | UUID | 属性 | 方向 |
|---|---|---|---|
| Speech Playback Service | `A92B3000-6E3B-4C5D-9F21-4A7C2D8E1B30` | Primary Service | — |
| TTS Control | `A92B3001-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write | 手机 → ESP32 |
| TTS Data | `A92B3002-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write、Write Without Response | 手机 → ESP32 |
| TTS Status | `A92B3003-6E3B-4C5D-9F21-4A7C2D8E1B30` | Notify | ESP32 → 手机 |

所有多字节整数均使用小端序。

## 4. 控制包

### 4.1 BEGIN，20 字节

写入 TTS Control。

| 偏移 | 长度 | 内容 |
|---:|---:|---|
| 0 | 1 | `0x01` BEGIN |
| 1 | 1 | 播放协议版本，当前为 `1` |
| 2 | 2 | Session ID，非 0 |
| 4 | 1 | Codec，`1`=IMA-ADPCM |
| 5 | 1 | PCM 位深，固定 `16` |
| 6 | 2 | 采样率，固定 `16000` |
| 8 | 4 | 解码后 PCM 样本数 |
| 12 | 4 | ADPCM 字节数，必须等于 `ceil((SampleCount-1)/2)` |
| 16 | 2 | IMA 初始 Predictor，int16 |
| 18 | 1 | IMA 初始 Index，0～88 |
| 19 | 1 | 每个数据包的 ADPCM 负载长度 |

ESP32 接受后通知 READY；忙碌、内存不足或参数错误时通知 ERROR。

### 4.2 END，7 字节

`[0x02][SessionId:2][CRC32:4]`

CRC32 使用 IEEE 802.3：多项式 `0xEDB88320`、初值 `0xFFFFFFFF`、最终异或 `0xFFFFFFFF`，校验范围仅为完整 ADPCM 数据。

### 4.3 ABORT，3 字节

`[0x03][SessionId:2]`

手机超时、断连或用户取消时发送。ESP32 立即释放当前会话状态。

## 5. 数据包

写入 TTS Data：

`[0x20][SessionId:2][Sequence:2][ADPCM payload:N]`

- Sequence 从 0 开始递增。
- `N = min(239, ATT_MTU - 8)`，MTU 23 时 N=15，MTU 247 时 N=239。
- 除最后一包外，每包 payload 长度必须等于 BEGIN 中声明的长度。
- 小程序每发送 8 包等待一次 ACK。
- ESP32 收到乱序包时返回当前 `NextExpectedSequence`，手机从该序号继续。

## 6. 状态通知

| 类型 | 格式 | 含义 |
|---|---|---|
| READY `0x10` | `[Type][Session:2][NextSequence:2]` | 已接受 BEGIN，准备接收 |
| ACK `0x11` | `[Type][Session:2][NextSequence:2]` | 下一个期望的包序号 |
| PLAYING `0x12` | `[Type][Session:2]` | CRC 正确，开始播放 |
| COMPLETE `0x13` | `[Type][Session:2]` | 所有样本已送入 I2S |
| ERROR `0x7F` | `[Type][Session:2][ErrorCode]` | 会话失败 |

错误码：1 内存不足；2 元数据错误；3 分片错误；4 CRC 错误；5 I2S/扬声器错误；6 正忙；7 接收超时。

## 7. ESP32 与 MAX98357A 接线

| MAX98357A | ESP32-S3 |
|---|---|
| DIN | GPIO8 |
| BCLK | GPIO5，与 INMP441 共用 |
| LRC/WS | GPIO4，与 INMP441 共用 |
| GND | GND，必须共地 |
| VIN | 按模块规格供电 |

MAX98357A 的声道选择应与固件的左声道配置一致。当前固件使用 I2S0 全双工：INMP441 使用 GPIO7 作为数据输入，MAX98357A 使用 GPIO8 作为数据输出。

## 8. 云函数配置

必须部署 `cloudfunctions/chat` 的最新代码，并安装云端依赖。腾讯云语音合成服务需先在控制台开通。

| 环境变量 | 必需 | 默认值 |
|---|---|---|
| `TTS_SECRET_ID` | 否 | 回退到 `ASR_SECRET_ID` |
| `TTS_SECRET_KEY` | 否 | 回退到 `ASR_SECRET_KEY` |
| `TTS_SESSION_TOKEN` | 否 | 回退到 `ASR_SESSION_TOKEN` |
| `TTS_REGION` | 否 | `ap-shanghai` |
| `TTS_VOICE_TYPE` | 否 | `1001` |
| `TTS_SPEED` | 否 | `0` |
| `TTS_VOLUME` | 否 | `0` |

单次最多朗读 150 个 Unicode 字符，最长音频 60 秒。云函数返回的 ADPCM 最大约 480KB。

## 9. 联调判定

1. 设备页显示协议 `1.2`，Capability 包含 bit 9。
2. 服务发现中存在完整 `A92B300x` 服务与三个特征。
3. 聊天收到文字回复后显示“正在生成云团语音”。
4. 小程序日志依次出现 BEGIN、READY、周期 ACK、END、PLAYING、COMPLETE。
5. ESP32 串口依次出现 `TTS: receiving`、`TTS: playback started`、`TTS: playback complete`。

如果文字回复正常但不朗读，先检查固件版本与 bit 9；如果提示服务未开通或认证失败，检查腾讯云 TTS 开通状态、云函数环境变量以及是否重新部署了 `chat` 云函数。

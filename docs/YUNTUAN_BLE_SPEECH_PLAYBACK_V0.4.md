# 云团 BLE 边收边播协议 v2

> 本协议直接替代旧版“完整接收、CRC 通过后才播放”的实现。控制协议版本为 `1.3`，TTS Protocol Version 为 `2`。

## 1. 链路

1. 流式 AI 首个约 16 字符句段到达后，`chat` 云函数立即合成 16kHz PCM 并编码为 IMA-ADPCM。
2. 小程序发送 BEGIN，随后按 MTU 分包下发。
3. ESP32 收到约 3200 字节 ADPCM（约 400ms 音频）后立即通知 PLAYING 并开始 I2S 播放，同时继续接收后续数据。
4. 小程序发完数据后发送 END；ESP32 校验完整 CRC。只有 END 已校验且全部样本播放完成后才通知 COMPLETE。

播放前不再等待完整 BLE 下发。设备仍保留线性缓冲区，以便完成最终 CRC 和在短暂下行抖动时继续播放。

## 2. GATT

| 名称 | UUID | 属性 | 方向 |
|---|---|---|---|
| Speech Playback Service | `A92B3000-6E3B-4C5D-9F21-4A7C2D8E1B30` | Primary Service | — |
| TTS Control | `A92B3001-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write | 小程序 → ESP32 |
| TTS Data | `A92B3002-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write Without Response | 小程序 → ESP32 |
| TTS Status | `A92B3003-6E3B-4C5D-9F21-4A7C2D8E1B30` | Notify | ESP32 → 小程序 |

## 3. 包格式

BEGIN 保持 20 字节：

`[0x01][Version=2][Session:2][Codec=1][Bits=16][Rate=16000:2][SampleCount:4][EncodedBytes:4][Predictor:2][Index][ChunkPayload]`

Data：`[0x20][Session:2][Sequence:2][ADPCM:N]`，其中 `N = min(239, ATT_MTU - 8)`。

END：`[0x02][Session:2][CRC32:4]`。ABORT：`[0x03][Session:2]`。

## 4. 状态

| 类型 | 格式 | 含义 |
|---|---|---|
| READY `0x10` | `[Type][Session:2][NextSequence:2]` | BEGIN 已接受 |
| ACK `0x11` | `[Type][Session:2][NextSequence:2]` | 下一个期望分包 |
| PLAYING `0x12` | `[Type][Session:2]` | 预缓冲达到阈值，已开始播放 |
| COMPLETE `0x13` | `[Type][Session:2]` | END 已校验且播放结束 |
| ERROR `0x7F` | `[Type][Session:2][ErrorCode]` | 会话失败 |

PLAYING 可能在小程序仍发送数据时到达。小程序必须在发第一包数据前监听 PLAYING，不能在 END 后才创建等待器。

## 5. 接线与云函数

MAX98357A：DIN→GPIO8，BCLK→GPIO5，LRC/WS→GPIO4，GND 共地；INMP441 的数据输入仍为 GPIO7。I2S0 使用同一 BCLK/WS 做全双工。

TTS 环境变量沿用 `TTS_SECRET_ID`、`TTS_SECRET_KEY`、`TTS_SESSION_TOKEN`、`TTS_REGION`、`TTS_VOICE_TYPE`、`TTS_SPEED`、`TTS_VOLUME`；没有单独配置 TTS 密钥时回退到对应 `ASR_*`。

## 6. 联调

1. 设备页显示协议 `1.3`，服务发现包含 `A92B300x`。
2. 串口顺序应为 `TTS: receiving` → `TTS: edge playback started` → `TTS: stream END verified` → `TTS: playback complete`。
3. 对 3 秒以上语音，PLAYING 应明显早于全部分包 ACK 完成。
4. `[VOICE_LATENCY].bleDownlinkToPlaybackMs` 用于衡量首段音频生成后到硬件首次播放的耗时。

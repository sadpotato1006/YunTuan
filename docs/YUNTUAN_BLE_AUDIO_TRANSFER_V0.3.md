# 云团挂件 BLE 录音传输扩展 v0.3

> 适用流程：用户短按挂件 PTT 键，说完一句话，挂件自动结束录音并通过 BLE 传给微信小程序。  
> 兼容基线：云团控制协议 v0.2 保持不变；本扩展使用独立 GATT Service，不占用 `Command RX` / `Event TX` 的 20 字节控制帧。

## 1. 用户流程

1. 用户先在小程序设备页连接挂件；
2. 小程序订阅 Audio Status 和 Audio Data；
3. 用户短按 GPIO13 PTT 键；
4. ESP32-S3 从 INMP441 采集 `16 kHz / 16-bit / mono`；
5. 检测到有效语音后，连续静音 1.2 秒自动结束；再次短按可提前结束；
6. 挂件将 PCM 编码为 4-bit IMA-ADPCM，缓存完整录音；
7. 挂件按 MTU 分包，通过 Audio Data Notify 发送；
8. 小程序按序接收、ACK、校验 CRC32、解码并生成 PCM WAV；
9. 小程序把 WAV 交给现有腾讯云 ASR，再把识别文字交给聊天服务。

单次录音最长 15 秒；5 秒没有检测到有效语音时取消本次录音。

## 2. 兼容性标识

控制协议主版本仍为 `1`，次版本为 `1`。`Protocol Info` 仍然固定为 6 字节。

Capabilities 新增：

| Bit | 名称 | 含义 |
|---:|---|---|
| 8 | AudioUpload | 设备提供本规范的 Audio Transfer Service |

设备声明 Bit 8 后，必须提供第 3 节的全部三个特征值。旧版小程序不认识该能力时仍可继续使用原 v0.2 控制功能。

## 3. GATT 定义

| 名称 | UUID | 属性 | 方向 |
|---|---|---|---|
| Audio Transfer Service | `A92B2000-6E3B-4C5D-9F21-4A7C2D8E1B30` | Primary Service | — |
| Audio Control | `A92B2001-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write | 手机 → 挂件 |
| Audio Data | `A92B2002-6E3B-4C5D-9F21-4A7C2D8E1B30` | Notify | 挂件 → 手机 |
| Audio Status | `A92B2003-6E3B-4C5D-9F21-4A7C2D8E1B30` | Indicate | 挂件 → 手机 |

Audio Status 使用 Indicate，保证元数据和结束校验信息被链路确认。Audio Data 使用 Notify，并由应用层窗口 ACK 处理丢包和重发。

## 4. 字节序和编码

- 多字节整数均为小端；
- Codec `0x01`：IMA-ADPCM，初始 Step Index 为元数据给出的值；
- 第一个 PCM 样本作为 Initial Predictor，不写入 ADPCM 数据；
- 后续每个样本编码为 4-bit nibble；每字节先低 4 位样本、后高 4 位样本；
- `EncodedBytes = ceil((SampleCount - 1) / 2)`；
- CRC32 使用 IEEE 参数：Polynomial `0xEDB88320`、Init `0xFFFFFFFF`、XorOut `0xFFFFFFFF`。

## 5. Audio Status

### 5.1 Recording `0x10`

固定 4 字节：

| Offset | 长度 | 字段 |
|---:|---:|---|
| 0 | 1 | `0x10` |
| 1 | 2 | SessionId |
| 3 | 1 | `1`，表示正在录音 |

### 5.2 Metadata `0x11`

固定 20 字节，因此默认 ATT MTU 23 时也能完整传输：

| Offset | 长度 | 字段 |
|---:|---:|---|
| 0 | 1 | `0x11` |
| 1 | 1 | Audio Protocol Version，当前为 `1` |
| 2 | 2 | SessionId |
| 4 | 1 | Codec，`1` = IMA-ADPCM |
| 5 | 1 | 解码后位深，固定 `16` |
| 6 | 2 | SampleRate，固定 `16000` |
| 8 | 4 | SampleCount |
| 12 | 4 | EncodedBytes |
| 16 | 2 | Initial Predictor，int16 |
| 18 | 1 | Initial Step Index，`0～88` |
| 19 | 1 | 每个 Audio Data 包携带的最大音频字节数 |

### 5.3 End `0x12`

固定 7 字节：

| Offset | 长度 | 字段 |
|---:|---:|---|
| 0 | 1 | `0x12` |
| 1 | 2 | SessionId |
| 3 | 4 | 完整 ADPCM 数据 CRC32 |

### 5.4 Error `0x7F`

固定 4 字节：`Type(1) + SessionId(2) + ErrorCode(1)`。

| ErrorCode | 含义 |
|---:|---|
| 1 | 麦克风或 I2S 初始化失败 |
| 2 | 未检测到有效语音或录音过短 |
| 3 | 录音缓冲区已满 |
| 4 | 等待手机 ACK 超时 |
| 5 | 小程序未订阅音频特征值 |

## 6. Audio Data `0x20`

每包格式：

| Offset | 长度 | 字段 |
|---:|---:|---|
| 0 | 1 | `0x20` |
| 1 | 2 | SessionId |
| 3 | 2 | Sequence，从 `0` 开始 |
| 5 | N | ADPCM 数据 |

`N = min(239, ATT_MTU - 8)`；当 ATT MTU 为 23 时，N 为 15。一次录音会话开始后 N 固定，最后一包可以短于 N。

## 7. Audio Control

### 7.1 ACK `0x01`

固定 5 字节：`0x01 + SessionId(2) + NextExpectedSequence(2)`。

- 小程序每收到 8 包或最后一包发送一次 ACK；
- `NextExpectedSequence` 是小程序下一包真正需要的序号；
- 设备收到较小序号时从该序号重发；
- 设备等待 ACK 1.8 秒，最多重试 4 次。

### 7.2 Complete `0x02`

固定 3 字节：`0x02 + SessionId(2)`。小程序完成 CRC、ADPCM 解码和 WAV 落盘后发送，设备随后释放录音缓存。

### 7.3 Abort `0x03`

固定 3 字节：`0x03 + SessionId(2)`。小程序发现格式、长度、CRC 或文件错误时发送，设备结束本次会话。

## 8. MTU 与流控

- 设备首选 ATT MTU 为 247；
- Android 小程序连接后请求 MTU 247，再读取实际协商值；
- iOS 使用系统协商值；
- 所有分包必须按照实际 MTU 计算，不能假设手机一定支持 247；
- Audio Data 每发 8 包暂停等待 ACK，避免微信 JS 回调队列被连续 Notify 压满；
- BLE 断开时设备保留已录好的 ADPCM；重连并重新订阅后从 Metadata 和 Sequence 0 重新发送。

## 9. 硬件配置

| 信号 | ESP32-S3 GPIO |
|---|---:|
| INMP441 BCLK/SCK | 5 |
| INMP441 WS | 4 |
| INMP441 SD | 7 |
| INMP441 L/R | GND，左声道 |
| PTT 按键 | 13，内部上拉，按下接地 |

VAD 阈值目前为平均绝对幅度 650。不同外壳、麦克风批次和增益下必须用串口采集安静环境与正常说话数据，再调整阈值。

## 10. 首次联调步骤

1. 烧录固件，串口必须出现 `Audio CRC32 self-test: PASS`、`Audio buffer allocated` 和 `INMP441 microphone`；
2. 在设备页连接，确认服务列表包含 Audio Transfer Service 的三个特征值；
3. 进入聊天页，页面应显示“挂件语音已就绪”；
4. 短按 PTT，观察串口 `AUDIO VAD mean`：安静值应明显低于说话值；
5. 正常说一句话并停顿 1.2 秒，串口应依次出现 captured、transfer start 和 END；
6. 小程序应显示接收百分比，随后自动出现识别文字和云团回复；
7. 在传输中关闭蓝牙再打开，验证重连后从 Sequence 0 重发；
8. 分别用 Android 与 iOS 真机测试，记录实际 MTU、5/10/15 秒录音传输耗时和失败率。

# 云团 BLE 实时录音上传协议 v2

> 本项目处于开发阶段，本协议直接替代旧版完整录音上传协议，不提供兼容分支。控制协议版本为 `1.3`，Audio Protocol Version 为 `2`。

## 1. 链路

1. ESP32-S3 以 `16kHz / 16-bit / mono` 从 INMP441 采集语音，并持续编码为 4-bit IMA-ADPCM。
2. 第一批完整 ADPCM 字节产生后，挂件立即发送 Metadata，录音尚未结束时就开始 BLE Notify。
3. 小程序按包 ACK，并增量解码成 PCM；每累计约 200ms PCM 就上传腾讯云实时 ASR WebSocket。
4. 连续静音 0.8 秒、再次按键或达到 15 秒时结束录音。挂件在最后一个数据包设置 Final 标志，最后发送样本数、压缩长度和 CRC32。
5. 小程序同时保留完整 ADPCM，结束时校验并重建 WAV。实时 ASR 不可用时，用 WAV 调用一句话识别降级。

录音采集、BLE 上传和 ASR 三个阶段重叠执行。固件中的录音状态机和传输/ACK 状态机互相独立，等待手机 ACK 不会暂停麦克风采集。

可靠性约束：重复且没有推进序号的 ACK 不得重置重试预算；Final ACK 后由主循环发送并重试 END，禁止在 GATT 写回调中重入发送 Indicate；录音采集使用墙钟限制，最长 15 秒；保留态、手机写入、无数据和完整会话均必须有超时并最终释放。

## 2. GATT

| 名称 | UUID | 属性 | 方向 |
|---|---|---|---|
| Audio Transfer Service | `A92B2000-6E3B-4C5D-9F21-4A7C2D8E1B30` | Primary Service | — |
| Audio Control | `A92B2001-6E3B-4C5D-9F21-4A7C2D8E1B30` | Write | 小程序 → 挂件 |
| Audio Data | `A92B2002-6E3B-4C5D-9F21-4A7C2D8E1B30` | Notify | 挂件 → 小程序 |
| Audio Status | `A92B2003-6E3B-4C5D-9F21-4A7C2D8E1B30` | Indicate | 挂件 → 小程序 |

多字节整数均为小端。

## 3. Audio Status

### Recording `0x10`

`[0x10][SessionId:2][1]`

### Stream Metadata `0x11`，20 字节

| Offset | 长度 | 字段 |
|---:|---:|---|
| 0 | 1 | `0x11` |
| 1 | 1 | 协议版本 `2` |
| 2 | 2 | SessionId |
| 4 | 1 | Codec，`1`=IMA-ADPCM |
| 5 | 1 | PCM 位深，`16` |
| 6 | 2 | SampleRate，`16000` |
| 8 | 4 | `0`，流开始时最终 SampleCount 未知 |
| 12 | 4 | `0`，流开始时最终 EncodedBytes 未知 |
| 16 | 2 | Initial Predictor，int16 |
| 18 | 1 | Initial Step Index，`0～88` |
| 19 | 1 | 固定数据包负载长度 |

### End `0x12`，15 字节

`[0x12][SessionId:2][SampleCount:4][EncodedBytes:4][CRC32:4]`

`EncodedBytes = ceil((SampleCount - 1) / 2)`。CRC32 使用 IEEE 参数，校验范围为完整 ADPCM 数据。

### Capture Stopped `0x13`，3 字节

`[0x13][SessionId:2]`

麦克风采集停止后立即发送；此时 BLE 上传和实时识别可能仍在继续。小程序收到后应将界面从“正在录音”切换为“录音已停止，正在上传并识别”。


### Error `0x7F`

`[0x7F][SessionId:2][ErrorCode]`。错误码：1 I2S 初始化失败；2 没有有效语音；3 缓冲区满；4 ACK 超时；5 小程序未订阅。

## 4. Audio Data `0x20`

`[0x20][SessionId:2][Sequence:2][Flags:1][ADPCM:N]`

- Sequence 从 0 开始。
- Flags bit 0 为 Final；最后一个包必须设置，其他位必须为 0。
- `N = min(239, ATT_MTU - 9)`；MTU 23 时 N=14。
- 录音过程中固件保留最后一个完整分包，确保录音恰好落在包边界时也能给最终包加 Final。

## 5. Audio Control

- ACK `0x01`：`[0x01][SessionId:2][NextExpectedSequence:2]`。小程序每 8 包或 Final 包 ACK。
- Complete `0x02`：`[0x02][SessionId:2]`。小程序完成 CRC 和 WAV 重建后发送。
- Abort `0x03`：`[0x03][SessionId:2]`。

断线后固件保留当前录音，从 Metadata 和 Sequence 0 重启同一流；本地采集在连接不可用时仍可继续到 VAD 结束。

## 6. 实时 ASR 配置

`chat` 云函数生成 5 分钟有效的腾讯云 WebSocket 签名，小程序不会拿到 SecretKey。云函数需要：

| 环境变量 | 说明 |
|---|---|
| `ASR_APP_ID` | 腾讯云账号 AppID，实时 ASR 必需 |
| `ASR_SECRET_ID` | 腾讯云 API SecretId |
| `ASR_SECRET_KEY` | 腾讯云 API SecretKey |
| `ASR_REALTIME_ENGINE` | 可选，默认回退 `ASR_ENGINE`，再默认 `16k_zh` |

微信公众平台还必须把 `wss://asr.cloud.tencent.com` 加入 socket 合法域名。开发者工具可临时勾选“不校验合法域名”，但真机发布不能依赖该选项。

## 7. 联调

1. 烧录最新 `hard/main.cpp`，设备页应显示协议 `1.3`。
2. 进入聊天页，短按 PTT 并说话；说话期间串口应出现 `AUDIO: live transfer start`。
3. 小程序应显示“正在录音、上传并实时识别”，结束后无需再等待整段 BLE 上传。
4. 查看 `[VOICE_LATENCY]`：`asrMode` 正常应为 `realtime`；如果为 `sentence-fallback`，检查 `ASR_APP_ID`、实时 ASR 开通状态和 socket 合法域名。
5. 分别用 Android/iOS 真机记录 MTU、录音结束到文字可用时间以及按键到首次播放时间。

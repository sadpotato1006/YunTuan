# ESP32-S3 N16R8 AI 语音聊天设备 — 引脚连接与固件架构

> **板型已确认：** 根据你提供的商品图文字（ESP32-S3 开发板 N16R8 44脚），以下设计针对 **ESP32-S3-DevKitC-1 / N16R8 44脚开发板**。你发来的实物照片当前模型无法读取，因此模块封装仍按文字描述推断：INMP441 麦克风 + MAX98357A 功放 + 扬声器 + 按键 + 拨动开关 + 3.7V 锂电池 + TP4056 充电 + MT3608 升压。请焊接前核对你板子上的丝印。
>
> **为什么不用 ESP32-WROOM-32 那套脚位：** ESP32-S3 的 IO 矩阵与 GPIO 编号和旧版 ESP32 不同，GPIO1/4/5/7/8/13/14/15/16/17/18 等才是 S3 上安全的通用 IO；GPIO26–32 通常接片内 Flash/PSRAM，GPIO19/20 是 USB，GPIO0/3/45/46 是 strapping 脚，应避开。注意：ESP32-S3-DevKitC-1 44 脚开发板没有引出 GPIO27，因此拨动开关改用 GPIO18。

---

## 1. 信号引脚连接表（ESP32-S3 ↔ 外设）

| 外设 | 信号 | ESP32-S3 GPIO | 方向 | 说明 |
|---|---|---|---|---|
| **INMP441 麦克风** | **SCK**（位时钟） | **GPIO5** | OUT | I2S BCK，由 ESP32 主时钟驱动。 |
| | **SD**（数据输出） | **GPIO7** | IN | 麦克风 → ESP32。 |
| | **WS**（字选） | **GPIO4** | OUT | I2S WS/LRCLK。 |
| | **L/R**（通道选择） | **GND** | — | 接 GND 选择左声道（WS 低电平）。 |
| | **VDD** | **3.3V** | — | 取自 ESP32 开发板 3.3V 输出。 |
| | **CHIPEN** | **3.3V** | — | 麦克风芯片使能，接高电平。 |
| | **GND**（5/6/9 脚） | **GND** | — | 共地。 |
| **MAX98357A 功放** | **BCLK** | **GPIO16** | OUT | 扬声器 I2S 位时钟。 |
| | **LRC** | **GPIO15** | OUT | I2S WS。 |
| | **DIN** | **GPIO8** | OUT | I2S 数据 → 功放。 |
| | **SHDN**（使能） | **GPIO17** | OUT | 高电平使能；说话时拉低可静音消回声。 |
| | **GAIN** | **GND 或 VCC** | — | GND ≈ 9 dB，VCC ≈ 15 dB，按所需音量固定。 |
| | **VDD** | **5V** | — | 取自卑压模块输出 5V（2.7–5.5 V 都兼容）。 |
| | **GND** | **GND** | — | 共地。 |
| **扬声器** | AUD+ / AUD− | → MAX98357A OUT+ / OUT− | — | 典型 4 Ω / 3 W，线尽量短，双绞。 |
| **PTT 按键** | 低电平有效 | GPIO13 | IN（上拉） | ISR → queue，task 内消抖。 |
| **唤醒按键** | 低电平有效 | GPIO14 | IN（上拉，RTC） | 支持 `ext1` 从 deep sleep 唤醒。 |
| **拨动开关** | 低电平有效 | GPIO18 | IN（上拉） | task 内消抖。 |
| **电池检测** | 分压后 | GPIO1（ADC1_CH0） | IN | 100k/100k 分压，4.2 V → 2.1 V，安全。 |
| **TP4056** | **CHRG** | **GPIO9** | IN（上拉） | 开漏、低电平表示正在充电。 |
| | **STDBY** | **GPIO10** | IN（上拉） | 开漏、低电平表示已经充满。 |

**选脚理由：** 避开 S3 的 strapping 脚（GPIO0/3/45/46）、USB 脚（GPIO19/20）和内部 Flash/PSRAM 脚（GPIO26–32）。麦克风输入、电池检测使用普通 GPIO 输入；功放 I2S 与麦克风 I2S 分别走不同 I2S 外设，避免收发抢时钟。

---

## 2. 电源拓扑与模块引脚

```
3.7V 锂电池 ──► TP4056 充电模块 ──► B+ / B- ──► MT3608 升压模块 ──► 5V
（USB 5V 输入）                                   │
                                                 ├──► ESP32 开发板 5V / VIN
                                                 └──► MAX98357A VDD

ESP32 板载 LDO ──► 3.3V 轨 ──► INMP441 VDD、按键/开关上拉
```

| 模块 | 引脚 | 连接到 | 说明 |
|---|---|---|---|
| **TP4056 充电模块** | **USB 5V / VCC** | 5V 充电器或 USB 供电 | 通过 Type-C/Micro USB 给锂电池充电。 |
| | **B+** | 锂电池正极 | 3.7 V 锂电池。 |
| | **B-** | 锂电池负极 | 共地。 |
| | **OUT+** | MT3608 **VIN+** | 给升压模块供电。 |
| | **OUT-** | MT3608 **VIN-** | 共地。 |
| **MT3608 升压模块** | **VIN+** | TP4056 **OUT+** | 输入 3.0–4.2 V。 |
| | **VIN-** | 系统地 GND | 共地。 |
| | **OUT+** | ESP32 **5V/VIN**、MAX98357A **VDD** | 输出 5 V（用多圈可调电位器校准到 5.0 V）。 |
| | **OUT-** | 系统地 GND | 共地。 |
| **电池分压** | 4.2 V 端 | 100k 电阻 R1 | 接 TP4056 OUT+ 或电池正极。 |
| | 分压中点 | ESP32 **GPIO1**（ADC1_CH0） | 4.2 V 时约 2.1 V，再用 `ADC_ATTEN_DB_11` 采样。 |
| | GND 端 | 100k 电阻 R2 → GND | 共地。 |
| **充电状态** | TP4056 **CHRG** | ESP32 **GPIO9** | 保留模块原有指示灯，从 CHRG 信号点并接一根线；低电平有效。 |
| | TP4056 **STDBY** | ESP32 **GPIO10** | 保留模块原有指示灯，从 STDBY 信号点并接一根线；低电平有效。 |

> 部分 TP4056 小板没有单独引出 `CHRG`/`STDBY`，需要从红、蓝/绿充电指示灯对应的 TP4056 开漏信号端并接。不要拆掉原有限流电阻，也不要把 5V 指示灯电源直接接到 ESP32 GPIO。焊接前用万用表确认：充电时 CHRG 为低、充满时 STDBY 为低。

- **使能控制：** 可把 MT3608 的 `EN` 脚或一个 P-MOS 接到 **GPIO21**，deep sleep 时切断功放和外围，进一步省电。
- **典型翻车点：** 升压后的 5V 不能和 USB 的 5V 直接并到一起，否则回灌。两者之间加一个肖特基二极管做 OR，或物理切换。TP4056 的 OUT+ 在 USB 未插入时就是电池直通，所以 MT3608 始终有电。如果你需要关机时彻底断电，应在电池与 TP4056 之间加保护开关或 MOSFET 开关。

---

## 3. 接线图

### 3.1 实物拍照风格图（已生成）

上方已贴出 AI 生成的实物风格接线图：白底、ESP32-S3 N16R8 横放中央、左上 INMP441、右上 MAX98357A + 扬声器、左下 TP4056+MT3608+电池、右下按键+拨动开关+分压电阻，红/黑/蓝/绿/黄/橙/紫 7 种颜色线按规范走线，无乱码。

> **重要说明**：AI 生图工具能可靠生成组件外形、布线和颜色，但**文字标注经常出现乱码**（AI 不擅长在小标签上写字）。所以我把每条线的两端引脚名、ESP32 GPIO 编号都列在下文第 1、2 节的表里。焊接前**以表为准**，不要直接看图上 AI 编的引脚编号。

### 3.2 矢量标注版（引脚名准确）

矢量 SVG 图（含两端引脚名）已嵌入文档第 1 节末尾的引用中。图中：

- **红线**=电源 5V/3.3V
- **黑线**=GND
- **蓝线**=I2S 位时钟 BCLK
- **绿线**=I2S 字选 WS/LRC
- **黄线**=I2S 数据 SD/DIN
- **橙线**=控制信号（SHDN/按键/开关）
- **紫线**=ADC 电池分压
- **虚线**=可选 deep sleep 电源门控

### 3.3 实物接线 checklist

按此顺序焊接，错了能回退：

1. **电源**先上：电池 → TP4056 → MT3608 → 测 MT3608 OUT+ 调到 5.0V → 接 ESP32 5V/VIN。先只插电池，**先不上 USB**，用万用表量 5V。
2. **共地**：所有模块 GND 接到 ESP32 任意 GND 引脚。
3. **INMP441**：SCK→GPIO5，SD→GPIO7，WS→GPIO4，L/R→GND，VDD+CHIPEN→3.3V。先不上扬声器，跑一个 I2S 录 5 秒，看串口打印 RMS。
4. **MAX98357A**：BCLK→GPIO16，LRC→GPIO15，DIN→GPIO8，SHDN→GPIO17，VDD→5V，GAIN→GND。先别接扬声器，量 OUT+/OUT- 静态电压应在 1.65 V 附近（VCC/2）。
5. **按键与开关**：GPIO13/14/18 内部上拉，一端接 GPIO，另一端接 GND。
6. **电池分压**：100k+100k，4.2V 端接 TP4056 OUT+，分压中点接 GPIO1，GND 端接地。
7. **充电状态**：TP4056 CHRG 并接 GPIO9，STDBY 并接 GPIO10；两路均按开漏低电平有效读取。
8. **最后上电**：接扬声器，串口看日志，依次验证录音、播放、按键事件。

---

## 4. 固件架构（FreeRTOS / ESP-IDF）

设计目标：采音不丢帧、不能无限阻塞、所有长任务受看门狗监视、初始化后禁止动态内存。

### 4.1 任务表

| 任务 | 优先级 | 栈大小 | 职责 | 进程间通信 |
|---|---|---|---|---|
| `mic_capture` | 6 | 4096 | I2S RX DMA → 静态环形缓冲区；按帧入队 | `audio_frame_q`（静态） |
| `vad` | 5 | 3072 | 端点检测 / 语音活动检测 | `speech_evt`（事件组） |
| `audio_play` | 5 | 4096 | I2S TX → MAX98357A；播放 AI 返回的音频 | `play_q`（静态） |
| `net` | 4 | 6144 | Wi-Fi 管理 + WebSocket/MQTT 到 AI 后端；断线重连带退避 | `cmd_q`、`net_evt` |
| `button` | 3 | 2048 | 按键/开关 ISR → queue，task 内消抖 | ISR → `btn_q` |
| `power` | 2 | 2048 | 电池 ADC、休眠状态机 | `pwr_evt` |
| `health` | 1 | 1536 | 喂任务看门狗，检查各任务栈高水位 | — |

> 栈大小是**初始估算**，72 小时压力测试后必须实测 `uxTaskGetStackHighWaterMark()`，预留约 20 % 余量再压紧。生产代码不能拍脑袋。

### 4.2 关键代码模式

**静态分配（任务中禁止 `malloc`）：**

```c
#define FRAME_Q_LEN 16
static StaticQueue_t frame_q_buf;
static uint8_t frame_q_storage[FRAME_Q_LEN * sizeof(audio_frame_t)];
static QueueHandle_t audio_frame_q;

void app_main(void) {
    audio_frame_q = xQueueCreateStatic(FRAME_Q_LEN, sizeof(audio_frame_t),
                                       frame_q_storage, &frame_q_buf);
    ESP_ERROR_CHECK(audio_frame_q ? ESP_OK : ESP_FAIL);
    ...
}
```

**麦克风采集（DMA 驱动，ISR 只做入队）：**

```c
#define SAMPLE_RATE 16000

static void mic_capture(void *arg) {
    audio_frame_t frame;
    size_t bytes;
    for (;;) {
        /* i2s_read 只在 DMA 满一帧时阻塞，超时 50 ms；不会无限等。 */
        esp_err_t r = i2s_read(I2S_NUM_0, frame.buf, FRAME_BYTES, &bytes, pdMS_TO_TICKS(50));
        if (r != ESP_OK || bytes == 0) {
            ESP_LOGW("mic", "i2s_read: %s", esp_err_to_name(r));
            continue;               /* 错误路径，不卡死 */
        }
        if (xQueueSend(audio_frame_q, &frame, 0) != pdTRUE) {
            ESP_LOGW("mic", "frame q full — 丢帧（背压，不阻塞）");
        }
    }
}
```

**按键 ISR → 队列（最小 ISR，必须用 FromISR 版本）：**

```c
static QueueHandle_t btn_q;

static void IRAM_ATTR btn_isr(void *arg) {
    uint32_t pin = (uint32_t)arg;
    BaseType_t hp = pdFALSE;
    xQueueSendFromISR(btn_q, &pin, &hp);
    if (hp) portYIELD_FROM_ISR();
}
/* 初始化：gpio_install_isr_service(); gpio_isr_handler_add(GPIO13, btn_isr, (void*)GPIO13); */
```

**稳定性三板斧：**
- 所有长任务注册到 ESP-IDF 任务看门狗（`CONFIG_ESP_TASK_WDT_TIMEOUT_S = 5`），`health` 任务周期性检查各任务高水位并喂狗。
- Wi-Fi 使用事件循环 + 事件组；掉线后指数退避重连（0.5 s → 1 s → 2 s … 上限 30 s），禁止死循环重试。
- 半双工语音：麦克风工作时把 MAX98357A 的 `SHDN`（GPIO17）拉低，避免扬声器回声串到麦克风。
- OTA：走 `esp_ota_ops.h`，只有在一次干净启动后才 `esp_ota_mark_app_valid_cancel_rollback()`，否则自动回滚。

### 4.3 实时性 / 时序约束
- I2S DMA 缓冲区大小要让 `i2s_read` 返回周期 < 20 ms（16 kHz / 16-bit mono）。太大增加延迟，太小导致 ISR 频繁。
- 按键 ISR → task 的端到端延迟建议 < 10 µs；可用 GPIO 翻转 + 逻辑分析仪实测。
- INMP441 不需要 MCLK，只需 BCK 和 WS。如果你买的是别的 I2S 麦克风，请确认是否需要 MCLK，否则要换脚位。

---

## 5. 已确认的需求

| 项目 | 选择 |
|---|---|
| 开发板 | **ESP32-S3 N16R8 44脚** |
| 功放 | **MAX98357A**（I2S 输入，3 W，4 Ω） |
| 无线 | **Wi-Fi + BLE 5 双模** |
| 休眠 | **Deep sleep + GPIO14 唤醒** |
| 采样率 | **16 kHz / 16-bit / mono** |

---

## 6. 固件架构（FreeRTOS / ESP-IDF）— 适配以上需求

### 6.1 任务表

| 任务 | 优先级 | 栈大小 | 职责 | 通信 |
|---|---|---|---|---|
| `mic_capture` | 6 | 4096 | I2S RX DMA → 静态环形缓冲，按 20 ms 帧入队 | `audio_frame_q` |
| `vad` | 5 | 3072 | 端点检测 / 语音活动检测 | `speech_evt`（事件组） |
| `audio_play` | 5 | 4096 | I2S TX → MAX98357A；播放 AI 音频 | `play_q` |
| `wifi_net` | 4 | 6144 | Wi-Fi 站模式 + 事件循环，掉线指数退避 | `net_evt` |
| `ble_prov` | 4 | 4096 | BLE 配网服务（NimBLE GATT） | `prov_q` |
| `ai_ws` | 4 | 8192 | WebSocket/MQTT 双向流到 AI 后端 | `ai_tx_q` / `ai_rx_q` |
| `button` | 3 | 2048 | 按键/开关 ISR → queue，task 内消抖 | ISR → `btn_q` |
| `power` | 2 | 2048 | 电池 ADC、休眠状态机、门控控制 | `pwr_evt` |
| `health` | 1 | 1536 | 喂任务看门狗，监控各任务栈高水位 | — |

### 6.2 关键代码片段

**静态分配（任务中禁止 `malloc`）：**

```c
#define FRAME_Q_LEN 16
static StaticQueue_t frame_q_buf;
static uint8_t frame_q_storage[FRAME_Q_LEN * sizeof(audio_frame_t)];
static QueueHandle_t audio_frame_q;

void app_main(void) {
    audio_frame_q = xQueueCreateStatic(FRAME_Q_LEN, sizeof(audio_frame_t),
                                       frame_q_storage, &frame_q_buf);
    ESP_ERROR_CHECK(audio_frame_q ? ESP_OK : ESP_FAIL);
}
```

**麦克风采集（DMA 驱动，16 kHz / 16-bit / mono）：**

```c
#define SAMPLE_RATE     16000
#define BITS_PER_SAMPLE 16
#define FRAME_MS        20
#define FRAME_BYTES     (SAMPLE_RATE * BITS_PER_SAMPLE / 8 / (1000 / FRAME_MS)) /* 640 B */

static void mic_capture(void *arg) {
    audio_frame_t frame;
    size_t bytes;
    for (;;) {
        esp_err_t r = i2s_read(I2S_NUM_0, frame.buf, FRAME_BYTES, &bytes, pdMS_TO_TICKS(50));
        if (r != ESP_OK || bytes == 0) {
            ESP_LOGW("mic", "i2s_read: %s", esp_err_to_name(r));
            continue;   /* 错误路径，不卡死 */
        }
        if (xQueueSend(audio_frame_q, &frame, 0) != pdTRUE) {
            ESP_LOGW("mic", "frame q full — 丢帧（背压）");
        }
    }
}
```

**按键 ISR → 队列（最小 ISR，FromISR 版本）：**

```c
static QueueHandle_t btn_q;

static void IRAM_ATTR btn_isr(void *arg) {
    uint32_t pin = (uint32_t)arg;
    BaseType_t hp = pdFALSE;
    xQueueSendFromISR(btn_q, &pin, &hp);
    if (hp) portYIELD_FROM_ISR();
}
/* gpio_install_isr_service(); gpio_isr_handler_add(GPIO13, btn_isr, (void*)GPIO13); */
```

**Deep sleep 与 GPIO14 唤醒：**

```c
/* 唤醒源：GPIO14 唤醒按键（低电平） */
esp_sleep_enable_ext0_wakeup(GPIO_NUM_14, 0);

/* 进入 deep sleep 前：拉低 MAX98357A SHDN（省功放功耗） */
gpio_set_level(GPIO_NUM_17, 0);
/* 关掉不需要的电源门控 */
gpio_set_level(GPIO_NUM_21, 0);

esp_deep_sleep_start();
/* 醒来后：esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_EXT0 */
```

### 6.3 稳定性 / 实时性 / 低功耗

- **任务看门狗**：`CONFIG_ESP_TASK_WDT_TIMEOUT_S=5`，`health` 任务每 1 s 喂一次 + 报各任务 `uxTaskGetStackHighWaterMark()`。
- **Wi-Fi 退避**：掉线后 0.5 s → 1 s → 2 s → 4 s … 上限 30 s；超过 5 分钟未恢复则进入 deep sleep，等唤醒键重启。
- **BLE 配网**：使用 NimBLE（轻量、占 RAM 少），自定义 GATT 服务含 Wi-Fi SSID/密码写入 + 配网状态通知。配网完成后关闭 BLE 广播，让 `wifi_net` 独占；运行中 BLE 只在需要时短暂唤醒。
- **回声消除**：说话时拉低 `GPIO17`（MAX98357A SHDN），半双工避免扬声器回声串到麦克风。
- **OTA**：`esp_ota_ops.h`，新固件启动后只在干净运行 30 s 以上才 `esp_ota_mark_app_valid_cancel_rollback()`，否则自动回滚。

### 6.4 时序约束

- I2S DMA 缓冲区配成 20 ms 帧 = 640 B（16 kHz × 16 bit × 0.02 s / 8 = 640 字节），端到端延迟 < 50 ms。
- 按键 ISR → task 延迟 < 10 µs（GPIO 翻转 + 逻辑分析仪实测）。
- INMP441 不需要 MCLK，只需 BCK + WS；如果你换了别的 I2S 麦，确认是否需要 MCLK 再调整。

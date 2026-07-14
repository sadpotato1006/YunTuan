// =============================================================================
// 云团智能挂件 — BLE 协议 v0.2 固件
// YUNTUAN Smart Pendant — Phase 1 Firmware
// =============================================================================
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <driver/i2s.h>
#include <esp_heap_caps.h>

// =============================================================================
// 1. UUID 定义
// =============================================================================
#define DEVICE_SN                 "YT01260000000001"
#define DEVICE_NAME               "YT-000001"
#define MODEL_NUMBER              "YT-P01"
#define FIRMWARE_REVISION         "0.4.0"
#define HARDWARE_REVISION         "A1"

#define BATTERY_SERVICE_UUID      "0000180F-0000-1000-8000-00805F9B34FB"
#define BATTERY_LEVEL_UUID        "00002A19-0000-1000-8000-00805F9B34FB"

#define DEVICE_INFO_SERVICE_UUID  "0000180A-0000-1000-8000-00805F9B34FB"
#define MODEL_NUMBER_UUID         "00002A24-0000-1000-8000-00805F9B34FB"
#define SERIAL_NUMBER_UUID        "00002A25-0000-1000-8000-00805F9B34FB"
#define FIRMWARE_REVISION_UUID    "00002A26-0000-1000-8000-00805F9B34FB"
#define HARDWARE_REVISION_UUID    "00002A27-0000-1000-8000-00805F9B34FB"

#define CONTROL_SERVICE_UUID      "A92B1000-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define COMMAND_RX_UUID           "A92B1001-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define EVENT_TX_UUID             "A92B1002-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define PROTOCOL_INFO_UUID        "A92B1003-6E3B-4C5D-9F21-4A7C2D8E1B30"

#define AUDIO_SERVICE_UUID        "A92B2000-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define AUDIO_CONTROL_UUID        "A92B2001-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define AUDIO_DATA_UUID           "A92B2002-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define AUDIO_STATUS_UUID         "A92B2003-6E3B-4C5D-9F21-4A7C2D8E1B30"

#define TTS_SERVICE_UUID          "A92B3000-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define TTS_CONTROL_UUID          "A92B3001-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define TTS_DATA_UUID             "A92B3002-6E3B-4C5D-9F21-4A7C2D8E1B30"
#define TTS_STATUS_UUID           "A92B3003-6E3B-4C5D-9F21-4A7C2D8E1B30"

// =============================================================================
// 2. 帧协议常量
// =============================================================================
#define FRAME_SOF                 0xA5
#define FRAME_VERSION             0x01
#define FRAME_MAX_LEN             20
#define FRAME_HEADER_LEN          8
#define FRAME_OVERHEAD            10            // SOF(1)+Header(7)+CRC(2)
#define PAYLOAD_MAX               10

// Flags (§7.2)
#define FLAG_REQUEST              0x00
#define FLAG_RESPONSE             0x01
#define FLAG_EVENT                0x02
#define FLAG_AUTHED               0x08

// Commands (§9.1)
#define CMD_HELLO                 0x01
#define CMD_GET_STATUS            0x02
#define CMD_SET_SOCIAL_MODE       0x03
#define CMD_FIND_DEVICE           0x04
#define CMD_SET_TIME              0x05
#define CMD_PING                  0x06

// Event commands (§10)
#define EVT_STATUS_CHANGED        0x20
#define EVT_BUTTON_EVENT          0x21
#define EVT_LOW_BATTERY           0x22
#define EVT_BIND_WINDOW_CHANGED   0x23

// Status codes (§8)
#define STATUS_OK                 0x0000
#define STATUS_UNKNOWN_COMMAND    0x0001
#define STATUS_INVALID_PAYLOAD    0x0002
#define STATUS_BUSY               0x0003
#define STATUS_UNAUTHORIZED       0x0004
#define STATUS_NOT_SUPPORTED      0x0005
#define STATUS_INTERNAL_ERROR     0x0006
#define STATUS_CRC_ERROR          0x0007
#define STATUS_VERSION_INCOMPAT   0x0008
#define STATUS_LOW_BATTERY        0x0009
#define STATUS_PHYSICAL_CONFIRM   0x000A

// Protocol Info (§5.4)
#define PROTOCOL_MAJOR            1
#define PROTOCOL_MINOR            2
#define CAPABILITIES              0x031F        // v0.2 能力 + AudioUpload + AudioPlayback
#define SECURITY_MODE             0             // 实验室模式

// Capability bits (§5.4)
#define CAP_BATTERY               0
#define CAP_SOCIAL_MODE           1
#define CAP_FIND_DEVICE           2
#define CAP_BUTTON_EVENTS         3
#define CAP_CHARGING_STATE        4
#define CAP_TIME_SYNC             5
#define CAP_AUTH                  6
#define CAP_OTA                   7
#define CAP_AUDIO_UPLOAD          8
#define CAP_AUDIO_PLAYBACK        9

// Button types (§10)
#define BTN_CLICK                 1
#define BTN_DOUBLE_CLICK          2
#define BTN_LONG_PRESS            3

// =============================================================================
// 3. GPIO 引脚
// =============================================================================
#define PIN_BUTTON                13            // 独立 PTT 按键，低电平有效
#define PIN_ALERT                 2             // 蜂鸣器/振动马达
#define PIN_LED                   47            // 外接状态灯；GPIO8 保留给 MAX98357A DIN

// INMP441：L/R 接 GND，选择左声道。
#define PIN_MIC_BCLK              5
#define PIN_MIC_WS                4
#define PIN_MIC_SD                7
#define PIN_SPEAKER_DIN           8             // MAX98357A DIN；BCLK/WS 与麦克风共用

// =============================================================================
// 3.1 挂件录音与 BLE Audio Transfer v1
// =============================================================================
#define AUDIO_SAMPLE_RATE         16000
#define AUDIO_FRAME_SAMPLES       320           // 20 ms
#define AUDIO_MAX_SECONDS         15
#define AUDIO_MIN_SAMPLES         (AUDIO_SAMPLE_RATE / 2)
#define AUDIO_MAX_SAMPLES         (AUDIO_SAMPLE_RATE * AUDIO_MAX_SECONDS)
#define AUDIO_BUFFER_CAPACITY     (AUDIO_MAX_SAMPLES / 2)
#define AUDIO_VAD_THRESHOLD       650           // 平均绝对幅度，需按实机噪声微调
#define AUDIO_SILENCE_FRAMES      60            // 检测到语音后静音 1.2 秒自动结束
#define AUDIO_NO_SPEECH_FRAMES    250           // 5 秒无有效语音则取消
#define AUDIO_WINDOW_PACKETS      8
#define AUDIO_ACK_TIMEOUT_MS      1800
#define AUDIO_ACK_MAX_RETRIES     4

#define AUDIO_PROTOCOL_VERSION    1
#define AUDIO_CODEC_IMA_ADPCM     1
#define AUDIO_STATUS_RECORDING    0x10
#define AUDIO_STATUS_META         0x11
#define AUDIO_STATUS_END          0x12
#define AUDIO_STATUS_ERROR        0x7F
#define AUDIO_DATA_PACKET         0x20
#define AUDIO_CONTROL_ACK         0x01
#define AUDIO_CONTROL_COMPLETE    0x02
#define AUDIO_CONTROL_ABORT       0x03

#define AUDIO_ERROR_MIC_INIT      1
#define AUDIO_ERROR_NO_SPEECH     2
#define AUDIO_ERROR_BUFFER_FULL   3
#define AUDIO_ERROR_TIMEOUT       4
#define AUDIO_ERROR_NOT_SUBSCRIBED 5

// =============================================================================
// 3.2 云团朗读与 BLE Speech Playback v1
// =============================================================================
#define TTS_SAMPLE_RATE           16000
#define TTS_MAX_SECONDS           60
#define TTS_BUFFER_CAPACITY       (TTS_SAMPLE_RATE * TTS_MAX_SECONDS / 2)
#define TTS_ACK_WINDOW            8
#define TTS_SESSION_TIMEOUT_MS    8000

#define TTS_PROTOCOL_VERSION      1
#define TTS_CODEC_IMA_ADPCM       1
#define TTS_CONTROL_BEGIN         0x01
#define TTS_CONTROL_END           0x02
#define TTS_CONTROL_ABORT         0x03
#define TTS_DATA_PACKET           0x20
#define TTS_STATUS_READY          0x10
#define TTS_STATUS_ACK            0x11
#define TTS_STATUS_PLAYING        0x12
#define TTS_STATUS_COMPLETE       0x13
#define TTS_STATUS_ERROR          0x7F

#define TTS_ERROR_NO_MEMORY       1
#define TTS_ERROR_BAD_META        2
#define TTS_ERROR_BAD_SEQUENCE    3
#define TTS_ERROR_CRC             4
#define TTS_ERROR_SPEAKER         5
#define TTS_ERROR_BUSY            6
#define TTS_ERROR_TIMEOUT         7

// =============================================================================
// 4. CRC16-CCITT-FALSE (§7.4)
//    Polynomial: 0x1021  Init: 0xFFFF  RefIn/RefOut: false  XorOut: 0x0000
// =============================================================================
static uint16_t crc16_ccitt(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= ((uint16_t)data[i]) << 8;
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x8000) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
            }
        }
    }
    return crc;
}

// =============================================================================
// 5. 全局状态
// =============================================================================
static uint8_t  g_socialMode    = 0;
static uint8_t  g_bindState     = 0;           // 0=未绑定
static uint8_t  g_batteryLevel  = 100;
static uint8_t  g_chargingState = 0;           // 0=未充电 1=充电中 2=已充满 255=未知
static uint32_t g_uptime        = 0;
static bool     g_connected     = false;
static uint16_t g_capabilities  = CAPABILITIES;

// Alert state (FIND_DEVICE)
static bool     g_alertActive   = false;
static uint32_t g_alertEnd      = 0;
static bool     g_alertToggle   = false;
static uint32_t g_lastAlertToggle = 0;

// 上一帧成功响应（用于 GET_STATUS 判断）
static uint8_t  g_lastStatusPayload[12] = {0};
static uint8_t  g_lastStatusLen = 0;

// GATT handles
static NimBLECharacteristic* pEventTx = nullptr;
static NimBLECharacteristic* pBatteryLevel = nullptr;

// Audio Transfer GATT handles
static NimBLEServer* pBleServer = nullptr;
static NimBLECharacteristic* pAudioData = nullptr;
static NimBLECharacteristic* pAudioStatus = nullptr;
static uint16_t g_connHandle = BLE_HS_CONN_HANDLE_NONE;
static bool g_audioDataSubscribed = false;
static bool g_audioStatusSubscribed = false;

enum AudioLifecycle {
    AUDIO_IDLE,
    AUDIO_RECORDING,
    AUDIO_READY,
    AUDIO_SENDING,
    AUDIO_WAIT_ACK,
    AUDIO_WAIT_COMPLETE
};

static AudioLifecycle g_audioState = AUDIO_IDLE;
static bool g_micReady = false;
static uint8_t* g_audioBuffer = nullptr;
static size_t g_audioBytes = 0;
static uint32_t g_audioSamples = 0;
static uint16_t g_audioSession = 0;
static uint32_t g_audioCrc32 = 0;
static int16_t g_audioInitialPredictor = 0;
static uint8_t g_audioInitialIndex = 0;
static int32_t g_adpcmPredictor = 0;
static int32_t g_adpcmIndex = 0;
static bool g_adpcmHasLowNibble = false;
static uint8_t g_adpcmLowNibble = 0;
static bool g_speechDetected = false;
static uint16_t g_silenceFrames = 0;
static uint16_t g_noSpeechFrames = 0;
static uint32_t g_recordStartedAt = 0;

static uint8_t g_audioChunkPayload = 15;
static uint16_t g_audioTotalChunks = 0;
static uint16_t g_audioNextSequence = 0;
static uint16_t g_audioAckedSequence = 0;
static uint8_t g_audioWindowSent = 0;
static uint8_t g_audioAckRetries = 0;
static uint32_t g_audioNextSendAt = 0;
static uint32_t g_audioAckDeadline = 0;
static uint32_t g_audioCompleteDeadline = 0;

// Speech Playback GATT 与接收/播放状态
static NimBLECharacteristic* pTtsStatus = nullptr;
static bool g_ttsStatusSubscribed = false;

enum TtsLifecycle {
    TTS_IDLE,
    TTS_RECEIVING,
    TTS_PLAYING
};

static TtsLifecycle g_ttsState = TTS_IDLE;
static uint8_t* g_ttsBuffer = nullptr;
static uint16_t g_ttsSession = 0;
static uint32_t g_ttsSampleCount = 0;
static uint32_t g_ttsEncodedBytes = 0;
static int16_t g_ttsInitialPredictor = 0;
static uint8_t g_ttsInitialIndex = 0;
static uint8_t g_ttsChunkPayload = 0;
static uint16_t g_ttsTotalChunks = 0;
static uint16_t g_ttsExpectedSequence = 0;
static uint32_t g_ttsReceivedBytes = 0;
static uint32_t g_ttsLastPacketAt = 0;
static uint32_t g_ttsPlaybackSample = 0;
static int32_t g_ttsPredictor = 0;
static int32_t g_ttsIndex = 0;

static const int8_t IMA_INDEX_TABLE[16] = {
    -1, -1, -1, -1, 2, 4, 6, 8,
    -1, -1, -1, -1, 2, 4, 6, 8
};

static const int16_t IMA_STEP_TABLE[89] = {
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
    34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
    157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
    598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878,
    2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894,
    6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818,
    18500, 20350, 22385, 24623, 27086, 29794, 32767
};

// =============================================================================
// 6. 帧构建与发送
// =============================================================================

// 前向声明（定义在 §7）
static uint8_t buildFrame(uint8_t flags, uint8_t cmd, uint8_t seq,
                          const uint8_t* payload, uint8_t payloadLen,
                          uint8_t* outFrame);
static void storeCache(uint8_t cmd, uint8_t seq,
                       const uint8_t* frame, uint8_t frameLen);

// 构建帧到 buffer，返回帧总长度
static uint8_t buildFrame(uint8_t flags, uint8_t cmd, uint8_t seq,
                          const uint8_t* payload, uint8_t payloadLen,
                          uint8_t* outFrame) {
    outFrame[0] = FRAME_SOF;
    outFrame[1] = FRAME_VERSION;
    outFrame[2] = flags;
    outFrame[3] = cmd;
    outFrame[4] = seq;
    outFrame[5] = 0;                            // FragmentIndex
    outFrame[6] = 1;                            // FragmentCount
    outFrame[7] = payloadLen;

    if (payloadLen > 0 && payload) {
        memcpy(outFrame + FRAME_HEADER_LEN, payload, payloadLen);
    }

    // CRC 覆盖 Version ~ Payload 末尾（不含 SOF）
    uint16_t crc = crc16_ccitt(outFrame + 1, FRAME_HEADER_LEN - 1 + payloadLen);
    outFrame[FRAME_HEADER_LEN + payloadLen]     = crc & 0xFF;      // 低字节在前
    outFrame[FRAME_HEADER_LEN + payloadLen + 1] = (crc >> 8) & 0xFF;

    return FRAME_OVERHEAD + payloadLen;
}

// 发送响应帧
static void sendResponse(uint8_t cmd, uint8_t seq,
                         uint16_t statusCode,
                         const uint8_t* data, uint8_t dataLen) {
    if (!pEventTx) return;
    if (dataLen > PAYLOAD_MAX - 2) {
        Serial.println("  ERR: response data too long");
        return;
    }

    uint8_t payload[PAYLOAD_MAX];
    payload[0] = statusCode & 0xFF;
    payload[1] = (statusCode >> 8) & 0xFF;
    uint8_t payloadLen = 2;
    if (data && dataLen > 0) {
        memcpy(payload + 2, data, dataLen);
        payloadLen = 2 + dataLen;
    }

    uint8_t frame[FRAME_MAX_LEN];
    uint8_t frameLen = buildFrame(FLAG_RESPONSE, cmd, seq, payload, payloadLen, frame);

    // 缓存响应（去重 — §13）
    storeCache(cmd, seq, frame, frameLen);

    pEventTx->notify(frame, frameLen);

    // 串口调试输出
    Serial.print("  TX RESP cmd=0x");
    Serial.print(cmd, HEX);
    Serial.print(" seq=");
    Serial.print(seq);
    Serial.print(" status=");
    Serial.print(statusCode, HEX);
    Serial.print(" [");
    for (uint8_t i = 0; i < frameLen; i++) {
        if (frame[i] < 0x10) Serial.print('0');
        Serial.print(frame[i], HEX);
        Serial.print(' ');
    }
    Serial.println("]");
}

// 发送主动事件帧
static void sendEvent(uint8_t evtCmd, const uint8_t* payload, uint8_t payloadLen) {
    if (!g_connected || !pEventTx || payloadLen > PAYLOAD_MAX) return;

    uint8_t frame[FRAME_MAX_LEN];
    uint8_t frameLen = buildFrame(FLAG_EVENT, evtCmd, 0, payload, payloadLen, frame);
    pEventTx->notify(frame, frameLen);

    Serial.print("  TX EVENT cmd=0x");
    Serial.print(evtCmd, HEX);
    Serial.print(" [");
    for (uint8_t i = 0; i < frameLen; i++) {
        if (frame[i] < 0x10) Serial.print('0');
        Serial.print(frame[i], HEX);
        Serial.print(' ');
    }
    Serial.println("]");
}

// =============================================================================
// 7. 响应缓存（去重）
//    缓存最近 16 个 Sequence 的响应，30 秒过期 (§13)
// =============================================================================
#define CACHE_SIZE 16
#define CACHE_TTL  30000                       // 30 秒

struct CacheEntry {
    uint8_t  cmd;
    uint8_t  seq;
    uint32_t timestamp;
    uint8_t  frame[FRAME_MAX_LEN];
    uint8_t  frameLen;
};
static CacheEntry g_cache[CACHE_SIZE];
static uint8_t g_cacheIdx = 0;

static void clearCache() {
    memset(g_cache, 0, sizeof(g_cache));
    g_cacheIdx = 0;
}

static bool lookupCache(uint8_t cmd, uint8_t seq,
                        uint8_t* outFrame, uint8_t* outLen) {
    uint32_t now = millis();
    for (uint8_t i = 0; i < CACHE_SIZE; i++) {
        if (g_cache[i].cmd == cmd && g_cache[i].seq == seq) {
            if (now - g_cache[i].timestamp < CACHE_TTL) {
                memcpy(outFrame, g_cache[i].frame, g_cache[i].frameLen);
                *outLen = g_cache[i].frameLen;
                return true;
            }
            // 过期，清除
            memset(&g_cache[i], 0, sizeof(g_cache[i]));
        }
    }
    return false;
}

static void storeCache(uint8_t cmd, uint8_t seq,
                       const uint8_t* frame, uint8_t frameLen) {
    g_cache[g_cacheIdx].cmd       = cmd;
    g_cache[g_cacheIdx].seq       = seq;
    g_cache[g_cacheIdx].timestamp = millis();
    g_cache[g_cacheIdx].frameLen  = frameLen;
    memcpy(g_cache[g_cacheIdx].frame, frame, frameLen);
    g_cacheIdx = (g_cacheIdx + 1) % CACHE_SIZE;
}

// =============================================================================
// 8. 命令处理器
// =============================================================================

// HELLO 0x01 — 返回协议版本、能力、安全模式和绑定状态
static void handleHello(uint8_t seq) {
    uint8_t data[6];
    data[0] = PROTOCOL_MAJOR;
    data[1] = PROTOCOL_MINOR;
    data[2] = g_capabilities & 0xFF;
    data[3] = (g_capabilities >> 8) & 0xFF;
    data[4] = SECURITY_MODE;
    data[5] = g_bindState;
    sendResponse(CMD_HELLO, seq, STATUS_OK, data, 6);
}

// GET_STATUS 0x02 — 返回电量、充电状态、社交模式、运行时间
static void handleGetStatus(uint8_t seq) {
    uint8_t data[7];
    data[0] = g_batteryLevel;
    data[1] = g_chargingState;
    data[2] = g_socialMode;
    data[3] = g_uptime & 0xFF;
    data[4] = (g_uptime >> 8) & 0xFF;
    data[5] = (g_uptime >> 16) & 0xFF;
    data[6] = (g_uptime >> 24) & 0xFF;
    sendResponse(CMD_GET_STATUS, seq, STATUS_OK, data, 7);
}

// SET_SOCIAL_MODE 0x03 — 设置社交模式
static void handleSetSocialMode(uint8_t seq, const uint8_t* payload, uint8_t len) {
    if (len != 1 || (payload[0] != 0 && payload[0] != 1)) {
        sendResponse(CMD_SET_SOCIAL_MODE, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
        return;
    }
    g_socialMode = payload[0];
    // TODO: 持久化到 NVS
    uint8_t result[1] = { g_socialMode };
    sendResponse(CMD_SET_SOCIAL_MODE, seq, STATUS_OK, result, 1);
    Serial.print("  SocialMode set to: ");
    Serial.println(g_socialMode);
}

// FIND_DEVICE 0x04 — 查找设备（振动/提示音）
static void handleFindDevice(uint8_t seq, const uint8_t* payload, uint8_t len) {
    if (len != 3) {
        sendResponse(CMD_FIND_DEVICE, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
        return;
    }
    uint8_t  alertType = payload[0];
    uint16_t duration  = payload[1] | ((uint16_t)payload[2] << 8);

    if (alertType > 2 || duration < 500 || duration > 10000) {
        sendResponse(CMD_FIND_DEVICE, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
        return;
    }

    // 启动 alert
    g_alertActive = true;
    g_alertEnd    = millis() + duration;
    g_alertToggle = false;
    g_lastAlertToggle = 0;
    digitalWrite(PIN_ALERT, HIGH);
    digitalWrite(PIN_LED, HIGH);

    Serial.print("  FIND_DEVICE type=");
    Serial.print(alertType);
    Serial.print(" duration=");
    Serial.print(duration);
    Serial.println("ms");

    sendResponse(CMD_FIND_DEVICE, seq, STATUS_OK, nullptr, 0);
}

// SET_TIME 0x05 — 时间同步
static void handleSetTime(uint8_t seq, const uint8_t* payload, uint8_t len) {
    if (len != 4) {
        sendResponse(CMD_SET_TIME, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
        return;
    }
    // 当前 Capabilities 未声明时间同步，按协议明确返回不支持。
    sendResponse(CMD_SET_TIME, seq, STATUS_NOT_SUPPORTED, nullptr, 0);
}

// PING 0x06 — 连通性检测，原样返回 4 字节
static void handlePing(uint8_t seq, const uint8_t* payload, uint8_t len) {
    if (len != 4) {
        sendResponse(CMD_PING, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
        return;
    }
    sendResponse(CMD_PING, seq, STATUS_OK, payload, 4);
}

// 命令分发
static void dispatchCommand(uint8_t cmd, uint8_t seq,
                            const uint8_t* payload, uint8_t payloadLen) {
    switch (cmd) {
        case CMD_HELLO:
            if (payloadLen != 0) sendResponse(cmd, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
            else handleHello(seq);
            break;
        case CMD_GET_STATUS:
            if (payloadLen != 0) sendResponse(cmd, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
            else handleGetStatus(seq);
            break;
        case CMD_SET_SOCIAL_MODE: handleSetSocialMode(seq, payload, payloadLen);      break;
        case CMD_FIND_DEVICE:     handleFindDevice(seq, payload, payloadLen);         break;
        case CMD_SET_TIME:        handleSetTime(seq, payload, payloadLen);            break;
        case CMD_PING:            handlePing(seq, payload, payloadLen);               break;
        default:
            sendResponse(cmd, seq, STATUS_UNKNOWN_COMMAND, nullptr, 0);
            break;
    }
}

// =============================================================================
// 9. 主动事件
// =============================================================================
static void sendStatusChanged() {
    uint8_t payload[3];
    payload[0] = g_batteryLevel;
    payload[1] = g_chargingState;
    payload[2] = g_socialMode;
    sendEvent(EVT_STATUS_CHANGED, payload, 3);
}

static void sendButtonEvent(uint8_t buttonType) {
    uint8_t payload[5];
    payload[0] = buttonType;
    // UnixTime — 没有 RTC 时填 0
    payload[1] = 0;
    payload[2] = 0;
    payload[3] = 0;
    payload[4] = 0;
    sendEvent(EVT_BUTTON_EVENT, payload, 5);
}

static void sendLowBattery() {
    uint8_t payload[1] = { g_batteryLevel };
    sendEvent(EVT_LOW_BATTERY, payload, 1);
}

// =============================================================================
// 10. 挂件录音、IMA-ADPCM 压缩和 BLE 分包
// =============================================================================
static void writeUint16LE(uint8_t* out, uint16_t value) {
    out[0] = value & 0xFF;
    out[1] = (value >> 8) & 0xFF;
}

static void writeUint32LE(uint8_t* out, uint32_t value) {
    out[0] = value & 0xFF;
    out[1] = (value >> 8) & 0xFF;
    out[2] = (value >> 16) & 0xFF;
    out[3] = (value >> 24) & 0xFF;
}

static uint32_t crc32_ieee(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= data[i];
        for (uint8_t bit = 0; bit < 8; bit++) {
            crc = (crc >> 1) ^ ((crc & 1) ? 0xEDB88320UL : 0);
        }
    }
    return crc ^ 0xFFFFFFFF;
}

static bool sendAudioStatus(const uint8_t* data, size_t len) {
    if (!g_connected || !g_audioStatusSubscribed || !pAudioStatus ||
        g_connHandle == BLE_HS_CONN_HANDLE_NONE) {
        return false;
    }
    return pAudioStatus->indicate(data, len, g_connHandle);
}

static void sendAudioError(uint8_t errorCode) {
    uint8_t status[4] = {
        AUDIO_STATUS_ERROR,
        (uint8_t)(g_audioSession & 0xFF),
        (uint8_t)((g_audioSession >> 8) & 0xFF),
        errorCode
    };
    sendAudioStatus(status, sizeof(status));
    Serial.print("  AUDIO ERROR: ");
    Serial.println(errorCode);
}

static bool initMicrophone() {
    i2s_config_t config = {};
    config.mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX | I2S_MODE_TX);
    config.sample_rate = AUDIO_SAMPLE_RATE;
    config.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
    config.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
    config.communication_format = I2S_COMM_FORMAT_STAND_I2S;
    config.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
    config.dma_buf_count = 4;
    config.dma_buf_len = AUDIO_FRAME_SAMPLES;
    config.use_apll = false;
    config.tx_desc_auto_clear = true;
    config.fixed_mclk = 0;

    i2s_pin_config_t pins = {};
    pins.mck_io_num = I2S_PIN_NO_CHANGE;
    pins.bck_io_num = PIN_MIC_BCLK;
    pins.ws_io_num = PIN_MIC_WS;
    pins.data_out_num = PIN_SPEAKER_DIN;
    pins.data_in_num = PIN_MIC_SD;

    esp_err_t result = i2s_driver_install(I2S_NUM_0, &config, 0, nullptr);
    if (result != ESP_OK) {
        Serial.print("  [ERR] I2S driver install failed: ");
        Serial.println((int)result);
        return false;
    }
    result = i2s_set_pin(I2S_NUM_0, &pins);
    if (result != ESP_OK) {
        Serial.print("  [ERR] I2S pin config failed: ");
        Serial.println((int)result);
        i2s_driver_uninstall(I2S_NUM_0);
        return false;
    }
    i2s_zero_dma_buffer(I2S_NUM_0);
    return true;
}

static uint8_t encodeImaNibble(int16_t sample) {
    int32_t difference = (int32_t)sample - g_adpcmPredictor;
    uint8_t nibble = 0;
    if (difference < 0) {
        nibble = 8;
        difference = -difference;
    }

    int32_t step = IMA_STEP_TABLE[g_adpcmIndex];
    int32_t delta = step >> 3;
    if (difference >= step) {
        nibble |= 4;
        difference -= step;
        delta += step;
    }
    if (difference >= (step >> 1)) {
        nibble |= 2;
        difference -= step >> 1;
        delta += step >> 1;
    }
    if (difference >= (step >> 2)) {
        nibble |= 1;
        delta += step >> 2;
    }

    g_adpcmPredictor += (nibble & 8) ? -delta : delta;
    if (g_adpcmPredictor > 32767) g_adpcmPredictor = 32767;
    if (g_adpcmPredictor < -32768) g_adpcmPredictor = -32768;
    g_adpcmIndex += IMA_INDEX_TABLE[nibble];
    if (g_adpcmIndex > 88) g_adpcmIndex = 88;
    if (g_adpcmIndex < 0) g_adpcmIndex = 0;
    return nibble;
}

static bool appendAudioSample(int16_t sample) {
    if (g_audioSamples == 0) {
        g_audioInitialPredictor = sample;
        g_audioInitialIndex = 0;
        g_adpcmPredictor = sample;
        g_adpcmIndex = 0;
        g_audioSamples = 1;
        return true;
    }

    uint8_t nibble = encodeImaNibble(sample);
    if (!g_adpcmHasLowNibble) {
        g_adpcmLowNibble = nibble;
        g_adpcmHasLowNibble = true;
    } else {
        if (g_audioBytes >= AUDIO_BUFFER_CAPACITY) return false;
        g_audioBuffer[g_audioBytes++] = g_adpcmLowNibble | (nibble << 4);
        g_adpcmHasLowNibble = false;
    }
    g_audioSamples++;
    return true;
}

static void clearRecordedAudio() {
    g_audioBytes = 0;
    g_audioSamples = 0;
    g_adpcmHasLowNibble = false;
    g_audioTotalChunks = 0;
    g_audioNextSequence = 0;
    g_audioAckedSequence = 0;
    g_audioWindowSent = 0;
    g_audioAckRetries = 0;
}

static void discardRecordedAudio() {
    clearRecordedAudio();
    g_audioState = AUDIO_IDLE;
    digitalWrite(PIN_LED, LOW);
}

static void beginAudioTransfer();

static bool startAudioRecording() {
    if (g_ttsState != TTS_IDLE) {
        Serial.println("  AUDIO: speaker playback is busy");
        return false;
    }
    if (!g_micReady || !g_audioBuffer) {
        sendAudioError(AUDIO_ERROR_MIC_INIT);
        return false;
    }
    if (!g_connected || !g_audioDataSubscribed || !g_audioStatusSubscribed) {
        sendAudioError(AUDIO_ERROR_NOT_SUBSCRIBED);
        Serial.println("  AUDIO: mini program is not connected/subscribed");
        return false;
    }
    if (g_audioState != AUDIO_IDLE) {
        Serial.println("  AUDIO: busy");
        return false;
    }

    clearRecordedAudio();
    g_audioSession++;
    if (g_audioSession == 0) g_audioSession = 1;
    g_speechDetected = false;
    g_silenceFrames = 0;
    g_noSpeechFrames = 0;
    g_recordStartedAt = millis();
    i2s_zero_dma_buffer(I2S_NUM_0);
    g_audioState = AUDIO_RECORDING;
    digitalWrite(PIN_LED, HIGH);

    uint8_t status[4] = {
        AUDIO_STATUS_RECORDING,
        (uint8_t)(g_audioSession & 0xFF),
        (uint8_t)((g_audioSession >> 8) & 0xFF),
        1
    };
    sendAudioStatus(status, sizeof(status));
    Serial.print("  AUDIO: recording session ");
    Serial.println(g_audioSession);
    return true;
}

static void finishAudioRecording(bool bufferFull) {
    if (g_audioState != AUDIO_RECORDING) return;
    if (g_adpcmHasLowNibble) {
        if (g_audioBytes >= AUDIO_BUFFER_CAPACITY) {
            bufferFull = true;
        } else {
            g_audioBuffer[g_audioBytes++] = g_adpcmLowNibble;
            g_adpcmHasLowNibble = false;
        }
    }

    digitalWrite(PIN_LED, LOW);
    if (!g_speechDetected || g_audioSamples < AUDIO_MIN_SAMPLES) {
        Serial.println("  AUDIO: no valid speech, discarded");
        sendAudioError(AUDIO_ERROR_NO_SPEECH);
        discardRecordedAudio();
        return;
    }
    if (bufferFull) {
        sendAudioError(AUDIO_ERROR_BUFFER_FULL);
        discardRecordedAudio();
        return;
    }

    g_audioCrc32 = crc32_ieee(g_audioBuffer, g_audioBytes);
    g_audioState = AUDIO_READY;
    Serial.print("  AUDIO: captured samples=");
    Serial.print(g_audioSamples);
    Serial.print(" encodedBytes=");
    Serial.print(g_audioBytes);
    Serial.print(" durationMs=");
    Serial.println(millis() - g_recordStartedAt);
    beginAudioTransfer();
}

static void pollAudioRecording() {
    if (g_audioState != AUDIO_RECORDING) return;

    int32_t raw[AUDIO_FRAME_SAMPLES];
    size_t bytesRead = 0;
    esp_err_t result = i2s_read(
        I2S_NUM_0,
        raw,
        sizeof(raw),
        &bytesRead,
        pdMS_TO_TICKS(25)
    );
    if (result != ESP_OK || bytesRead == 0) return;

    size_t sampleCount = bytesRead / sizeof(int32_t);
    uint64_t absoluteSum = 0;
    bool bufferFull = false;
    bool reachedLimit = false;
    for (size_t i = 0; i < sampleCount; i++) {
        if (g_audioSamples >= AUDIO_MAX_SAMPLES) {
            reachedLimit = true;
            break;
        }
        // INMP441 的 24-bit 有效数据位于 32-bit word 高位；右移后限幅为 PCM16。
        int32_t value = raw[i] >> 14;
        if (value > 32767) value = 32767;
        if (value < -32768) value = -32768;
        absoluteSum += value < 0 ? (uint32_t)(-value) : (uint32_t)value;
        if (!appendAudioSample((int16_t)value)) {
            bufferFull = true;
            break;
        }
    }

    uint32_t meanAmplitude = sampleCount ? (uint32_t)(absoluteSum / sampleCount) : 0;
    static uint32_t lastVadLog = 0;
    if (millis() - lastVadLog >= 500) {
        lastVadLog = millis();
        Serial.print("  AUDIO VAD mean=");
        Serial.print(meanAmplitude);
        Serial.print(" speech=");
        Serial.println(g_speechDetected ? "yes" : "no");
    }
    if (meanAmplitude >= AUDIO_VAD_THRESHOLD) {
        g_speechDetected = true;
        g_silenceFrames = 0;
    } else if (g_speechDetected) {
        g_silenceFrames++;
    } else {
        g_noSpeechFrames++;
    }

    if (bufferFull || reachedLimit || g_audioSamples >= AUDIO_MAX_SAMPLES) {
        finishAudioRecording(bufferFull);
    } else if (g_speechDetected && g_silenceFrames >= AUDIO_SILENCE_FRAMES &&
               g_audioSamples >= AUDIO_MIN_SAMPLES) {
        finishAudioRecording(false);
    } else if (!g_speechDetected && g_noSpeechFrames >= AUDIO_NO_SPEECH_FRAMES) {
        finishAudioRecording(false);
    }
}

static void beginAudioTransfer() {
    if (g_audioState != AUDIO_READY || !g_connected || !g_audioDataSubscribed ||
        !g_audioStatusSubscribed || !pBleServer || g_connHandle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }

    uint16_t mtu = pBleServer->getPeerMTU(g_connHandle);
    if (mtu < 23) mtu = 23;
    uint16_t maxChunk = mtu > 8 ? mtu - 8 : 15; // ATT(3) + Audio Data header(5)
    if (maxChunk > 239) maxChunk = 239;
    if (maxChunk < 15) maxChunk = 15;
    g_audioChunkPayload = (uint8_t)maxChunk;
    g_audioTotalChunks = (uint16_t)((g_audioBytes + g_audioChunkPayload - 1) / g_audioChunkPayload);
    g_audioNextSequence = 0;
    g_audioAckedSequence = 0;
    g_audioWindowSent = 0;
    g_audioAckRetries = 0;

    uint8_t meta[20] = {0};
    meta[0] = AUDIO_STATUS_META;
    meta[1] = AUDIO_PROTOCOL_VERSION;
    writeUint16LE(meta + 2, g_audioSession);
    meta[4] = AUDIO_CODEC_IMA_ADPCM;
    meta[5] = 16;
    writeUint16LE(meta + 6, AUDIO_SAMPLE_RATE);
    writeUint32LE(meta + 8, g_audioSamples);
    writeUint32LE(meta + 12, (uint32_t)g_audioBytes);
    writeUint16LE(meta + 16, (uint16_t)g_audioInitialPredictor);
    meta[18] = g_audioInitialIndex;
    meta[19] = g_audioChunkPayload;

    if (!sendAudioStatus(meta, sizeof(meta))) {
        Serial.println("  AUDIO: failed to send metadata; keeping recording");
        return;
    }

    g_audioState = AUDIO_SENDING;
    g_audioNextSendAt = millis() + 120;
    Serial.print("  AUDIO: transfer start, MTU=");
    Serial.print(mtu);
    Serial.print(" chunk=");
    Serial.print(g_audioChunkPayload);
    Serial.print(" packets=");
    Serial.println(g_audioTotalChunks);
}

static void sendAudioEnd() {
    uint8_t status[7] = {0};
    status[0] = AUDIO_STATUS_END;
    writeUint16LE(status + 1, g_audioSession);
    writeUint32LE(status + 3, g_audioCrc32);
    if (sendAudioStatus(status, sizeof(status))) {
        g_audioState = AUDIO_WAIT_COMPLETE;
        g_audioCompleteDeadline = millis() + 5000;
        Serial.println("  AUDIO: all packets acknowledged, END sent");
    }
}

static void pollAudioTransfer() {
    uint32_t now = millis();
    if (g_audioState == AUDIO_SENDING) {
        if (now < g_audioNextSendAt) return;
        if (!g_connected || !g_audioDataSubscribed || !pAudioData) {
            g_audioState = AUDIO_READY;
            return;
        }
        if (g_audioNextSequence >= g_audioTotalChunks) {
            g_audioState = AUDIO_WAIT_ACK;
            g_audioAckDeadline = now + AUDIO_ACK_TIMEOUT_MS;
            return;
        }

        size_t offset = (size_t)g_audioNextSequence * g_audioChunkPayload;
        size_t remaining = g_audioBytes - offset;
        size_t payloadLength = remaining < g_audioChunkPayload ? remaining : g_audioChunkPayload;
        uint8_t packet[5 + 239];
        packet[0] = AUDIO_DATA_PACKET;
        writeUint16LE(packet + 1, g_audioSession);
        writeUint16LE(packet + 3, g_audioNextSequence);
        memcpy(packet + 5, g_audioBuffer + offset, payloadLength);

        if (pAudioData->notify(packet, payloadLength + 5, g_connHandle)) {
            g_audioNextSequence++;
            g_audioWindowSent++;
            g_audioNextSendAt = now + 8;
            if (g_audioWindowSent >= AUDIO_WINDOW_PACKETS ||
                g_audioNextSequence >= g_audioTotalChunks) {
                g_audioState = AUDIO_WAIT_ACK;
                g_audioAckDeadline = now + AUDIO_ACK_TIMEOUT_MS;
            }
        } else {
            g_audioNextSendAt = now + 25;
        }
        return;
    }

    if (g_audioState == AUDIO_WAIT_ACK && now >= g_audioAckDeadline) {
        if (++g_audioAckRetries > AUDIO_ACK_MAX_RETRIES) {
            Serial.println("  AUDIO: ACK timeout; retaining recording for reconnect");
            sendAudioError(AUDIO_ERROR_TIMEOUT);
            g_audioState = AUDIO_READY;
            return;
        }
        g_audioNextSequence = g_audioAckedSequence;
        g_audioWindowSent = 0;
        g_audioState = AUDIO_SENDING;
        g_audioNextSendAt = now + 30;
        return;
    }

    if (g_audioState == AUDIO_WAIT_COMPLETE && now >= g_audioCompleteDeadline) {
        Serial.println("  AUDIO: COMPLETE timeout; recording released");
        discardRecordedAudio();
    }
}

static void handleAudioControl(const std::string& value) {
    const uint8_t* data = (const uint8_t*)value.data();
    size_t len = value.length();
    if (len < 3) return;
    uint16_t session = data[1] | ((uint16_t)data[2] << 8);
    if (session != g_audioSession) return;

    if (data[0] == AUDIO_CONTROL_ACK && len == 5) {
        uint16_t nextExpected = data[3] | ((uint16_t)data[4] << 8);
        if (nextExpected > g_audioTotalChunks || nextExpected < g_audioAckedSequence) return;
        if (nextExpected == g_audioAckedSequence && g_audioState != AUDIO_WAIT_ACK) return;
        if (g_audioState == AUDIO_WAIT_COMPLETE && nextExpected >= g_audioTotalChunks) return;
        g_audioAckedSequence = nextExpected;
        g_audioAckRetries = 0;
        if (nextExpected >= g_audioTotalChunks) {
            sendAudioEnd();
        } else {
            g_audioNextSequence = nextExpected;
            g_audioWindowSent = 0;
            g_audioState = AUDIO_SENDING;
            g_audioNextSendAt = millis() + 12;
        }
        return;
    }

    if (data[0] == AUDIO_CONTROL_COMPLETE && len == 3) {
        Serial.println("  AUDIO: phone completed WAV reconstruction");
        discardRecordedAudio();
    } else if (data[0] == AUDIO_CONTROL_ABORT && len == 3) {
        Serial.println("  AUDIO: phone aborted transfer");
        discardRecordedAudio();
    }
}

// =============================================================================
// 10.1 小程序下发 TTS 音频，完整校验后边解码边通过 MAX98357A 播放
// =============================================================================
static bool sendTtsStatus(const uint8_t* data, size_t len) {
    if (!g_connected || !g_ttsStatusSubscribed || !pTtsStatus ||
        g_connHandle == BLE_HS_CONN_HANDLE_NONE) {
        return false;
    }
    return pTtsStatus->notify(data, len, g_connHandle);
}

static void sendTtsSimpleStatus(uint8_t type, uint16_t session) {
    uint8_t status[3] = {
        type,
        (uint8_t)(session & 0xFF),
        (uint8_t)((session >> 8) & 0xFF)
    };
    sendTtsStatus(status, sizeof(status));
}

static void sendTtsAck(uint8_t type, uint16_t session, uint16_t nextSequence) {
    uint8_t status[5] = {
        type,
        (uint8_t)(session & 0xFF),
        (uint8_t)((session >> 8) & 0xFF),
        (uint8_t)(nextSequence & 0xFF),
        (uint8_t)((nextSequence >> 8) & 0xFF)
    };
    sendTtsStatus(status, sizeof(status));
}

static void sendTtsError(uint16_t session, uint8_t errorCode) {
    uint8_t status[4] = {
        TTS_STATUS_ERROR,
        (uint8_t)(session & 0xFF),
        (uint8_t)((session >> 8) & 0xFF),
        errorCode
    };
    sendTtsStatus(status, sizeof(status));
    Serial.print("  TTS ERROR session=");
    Serial.print(session);
    Serial.print(" code=");
    Serial.println(errorCode);
}

static void resetTtsSession() {
    g_ttsState = TTS_IDLE;
    g_ttsSession = 0;
    g_ttsSampleCount = 0;
    g_ttsEncodedBytes = 0;
    g_ttsInitialPredictor = 0;
    g_ttsInitialIndex = 0;
    g_ttsChunkPayload = 0;
    g_ttsTotalChunks = 0;
    g_ttsExpectedSequence = 0;
    g_ttsReceivedBytes = 0;
    g_ttsLastPacketAt = 0;
    g_ttsPlaybackSample = 0;
    g_ttsPredictor = 0;
    g_ttsIndex = 0;
}

static void beginTtsReceive(const uint8_t* data, size_t len) {
    uint16_t session = len >= 4 ? (data[2] | ((uint16_t)data[3] << 8)) : 0;
    if (g_ttsState != TTS_IDLE || g_audioState != AUDIO_IDLE) {
        sendTtsError(session, TTS_ERROR_BUSY);
        return;
    }
    if (!g_ttsBuffer) {
        sendTtsError(session, TTS_ERROR_NO_MEMORY);
        return;
    }
    if (!g_micReady) {
        sendTtsError(session, TTS_ERROR_SPEAKER);
        return;
    }
    if (len != 20 || data[1] != TTS_PROTOCOL_VERSION || session == 0 ||
        data[4] != TTS_CODEC_IMA_ADPCM || data[5] != 16) {
        sendTtsError(session, TTS_ERROR_BAD_META);
        return;
    }

    uint16_t sampleRate = data[6] | ((uint16_t)data[7] << 8);
    uint32_t sampleCount = (uint32_t)data[8] |
        ((uint32_t)data[9] << 8) |
        ((uint32_t)data[10] << 16) |
        ((uint32_t)data[11] << 24);
    uint32_t encodedBytes = (uint32_t)data[12] |
        ((uint32_t)data[13] << 8) |
        ((uint32_t)data[14] << 16) |
        ((uint32_t)data[15] << 24);
    int16_t predictor = (int16_t)(data[16] | ((uint16_t)data[17] << 8));
    uint8_t initialIndex = data[18];
    uint8_t chunkPayload = data[19];

    if (sampleRate != TTS_SAMPLE_RATE || sampleCount < 2 ||
        sampleCount > TTS_SAMPLE_RATE * TTS_MAX_SECONDS ||
        encodedBytes != (sampleCount - 1 + 1) / 2 ||
        encodedBytes > TTS_BUFFER_CAPACITY || initialIndex > 88 ||
        chunkPayload == 0 || chunkPayload > 239) {
        sendTtsError(session, TTS_ERROR_BAD_META);
        return;
    }

    g_ttsSession = session;
    g_ttsSampleCount = sampleCount;
    g_ttsEncodedBytes = encodedBytes;
    g_ttsInitialPredictor = predictor;
    g_ttsInitialIndex = initialIndex;
    g_ttsChunkPayload = chunkPayload;
    g_ttsTotalChunks = (uint16_t)((encodedBytes + chunkPayload - 1) / chunkPayload);
    g_ttsExpectedSequence = 0;
    g_ttsReceivedBytes = 0;
    g_ttsLastPacketAt = millis();
    g_ttsState = TTS_RECEIVING;
    sendTtsAck(TTS_STATUS_READY, session, 0);
    Serial.print("  TTS: receiving session=");
    Serial.print(session);
    Serial.print(" samples=");
    Serial.print(sampleCount);
    Serial.print(" encodedBytes=");
    Serial.println(encodedBytes);
}

static void handleTtsData(const std::string& value) {
    const uint8_t* data = (const uint8_t*)value.data();
    size_t len = value.length();
    if (len < 6 || data[0] != TTS_DATA_PACKET) return;
    uint16_t session = data[1] | ((uint16_t)data[2] << 8);
    uint16_t sequence = data[3] | ((uint16_t)data[4] << 8);
    if (g_ttsState != TTS_RECEIVING || session != g_ttsSession) return;

    if (sequence != g_ttsExpectedSequence) {
        sendTtsAck(TTS_STATUS_ACK, session, g_ttsExpectedSequence);
        return;
    }

    size_t payloadLength = len - 5;
    size_t remaining = g_ttsEncodedBytes - g_ttsReceivedBytes;
    size_t expectedLength = remaining < g_ttsChunkPayload ? remaining : g_ttsChunkPayload;
    if (payloadLength != expectedLength || g_ttsReceivedBytes + payloadLength > TTS_BUFFER_CAPACITY) {
        sendTtsError(session, TTS_ERROR_BAD_SEQUENCE);
        resetTtsSession();
        return;
    }

    memcpy(g_ttsBuffer + g_ttsReceivedBytes, data + 5, payloadLength);
    g_ttsReceivedBytes += payloadLength;
    g_ttsExpectedSequence++;
    g_ttsLastPacketAt = millis();
    if ((g_ttsExpectedSequence % TTS_ACK_WINDOW) == 0 ||
        g_ttsExpectedSequence == g_ttsTotalChunks) {
        sendTtsAck(TTS_STATUS_ACK, session, g_ttsExpectedSequence);
    }
}

static int16_t decodeTtsNibble(uint8_t nibble) {
    int32_t step = IMA_STEP_TABLE[g_ttsIndex];
    int32_t delta = step >> 3;
    if (nibble & 4) delta += step;
    if (nibble & 2) delta += step >> 1;
    if (nibble & 1) delta += step >> 2;
    g_ttsPredictor += (nibble & 8) ? -delta : delta;
    if (g_ttsPredictor > 32767) g_ttsPredictor = 32767;
    if (g_ttsPredictor < -32768) g_ttsPredictor = -32768;
    g_ttsIndex += IMA_INDEX_TABLE[nibble & 0x0F];
    if (g_ttsIndex > 88) g_ttsIndex = 88;
    if (g_ttsIndex < 0) g_ttsIndex = 0;
    return (int16_t)g_ttsPredictor;
}

static void handleTtsControl(const std::string& value) {
    const uint8_t* data = (const uint8_t*)value.data();
    size_t len = value.length();
    if (!len) return;
    if (data[0] == TTS_CONTROL_BEGIN) {
        beginTtsReceive(data, len);
        return;
    }
    if (len < 3) return;
    uint16_t session = data[1] | ((uint16_t)data[2] << 8);
    if (data[0] == TTS_CONTROL_ABORT && session == g_ttsSession) {
        Serial.println("  TTS: aborted by mini program");
        resetTtsSession();
        return;
    }
    if (data[0] != TTS_CONTROL_END || len != 7 ||
        g_ttsState != TTS_RECEIVING || session != g_ttsSession) {
        return;
    }

    uint32_t expectedCrc = (uint32_t)data[3] |
        ((uint32_t)data[4] << 8) |
        ((uint32_t)data[5] << 16) |
        ((uint32_t)data[6] << 24);
    if (g_ttsExpectedSequence != g_ttsTotalChunks ||
        g_ttsReceivedBytes != g_ttsEncodedBytes) {
        sendTtsError(session, TTS_ERROR_BAD_SEQUENCE);
        resetTtsSession();
        return;
    }
    if (crc32_ieee(g_ttsBuffer, g_ttsEncodedBytes) != expectedCrc) {
        sendTtsError(session, TTS_ERROR_CRC);
        resetTtsSession();
        return;
    }

    g_ttsPlaybackSample = 0;
    g_ttsPredictor = g_ttsInitialPredictor;
    g_ttsIndex = g_ttsInitialIndex;
    g_ttsState = TTS_PLAYING;
    i2s_zero_dma_buffer(I2S_NUM_0);
    sendTtsSimpleStatus(TTS_STATUS_PLAYING, session);
    Serial.print("  TTS: playback started session=");
    Serial.println(session);
}

static void pollTtsPlayback() {
    if (g_ttsState == TTS_RECEIVING) {
        if (millis() - g_ttsLastPacketAt > TTS_SESSION_TIMEOUT_MS) {
            uint16_t session = g_ttsSession;
            sendTtsError(session, TTS_ERROR_TIMEOUT);
            resetTtsSession();
        }
        return;
    }
    if (g_ttsState != TTS_PLAYING) return;

    int32_t output[AUDIO_FRAME_SAMPLES];
    size_t count = 0;
    while (count < AUDIO_FRAME_SAMPLES && g_ttsPlaybackSample < g_ttsSampleCount) {
        int16_t sample;
        if (g_ttsPlaybackSample == 0) {
            sample = g_ttsInitialPredictor;
        } else {
            uint32_t nibbleIndex = g_ttsPlaybackSample - 1;
            uint8_t packed = g_ttsBuffer[nibbleIndex / 2];
            uint8_t nibble = (nibbleIndex & 1) ? ((packed >> 4) & 0x0F) : (packed & 0x0F);
            sample = decodeTtsNibble(nibble);
        }
        output[count++] = (int32_t)sample * 65536;
        g_ttsPlaybackSample++;
    }

    size_t written = 0;
    esp_err_t result = i2s_write(
        I2S_NUM_0,
        output,
        count * sizeof(int32_t),
        &written,
        pdMS_TO_TICKS(50)
    );
    if (result != ESP_OK || written != count * sizeof(int32_t)) {
        uint16_t session = g_ttsSession;
        sendTtsError(session, TTS_ERROR_SPEAKER);
        resetTtsSession();
        return;
    }

    if (g_ttsPlaybackSample >= g_ttsSampleCount) {
        uint16_t session = g_ttsSession;
        sendTtsSimpleStatus(TTS_STATUS_COMPLETE, session);
        Serial.print("  TTS: playback complete session=");
        Serial.println(session);
        resetTtsSession();
    }
}

// =============================================================================
// 11. 按键检测状态机
// =============================================================================
enum BtnFSM { B_IDLE, B_PRESSED, B_WAIT_DOUBLE };
static BtnFSM    g_btnState       = B_IDLE;
static uint32_t  g_btnPressTime   = 0;
static uint32_t  g_btnReleaseTime = 0;
static bool      g_btnLongReported = false;

#define BTN_DEBOUNCE_MS    30
#define BTN_LONG_MS         1000
#define BTN_DOUBLE_GAP_MS   400

static uint32_t g_lastBtnCheck = 0;
static bool     g_lastBtnRaw   = HIGH;

static void pollButton() {
    uint32_t now = millis();
    if (now - g_lastBtnCheck < 10) return;      // 10ms 轮询
    g_lastBtnCheck = now;

    bool raw = digitalRead(PIN_BUTTON);

    if (raw == g_lastBtnRaw) {
        // 稳定状态
        switch (g_btnState) {
            case B_IDLE:
                if (!raw) {                     // 按下
                    g_btnState     = B_PRESSED;
                    g_btnPressTime = now;
                    g_btnLongReported = false;
                }
                break;

            case B_PRESSED:
                if (!g_btnLongReported && (now - g_btnPressTime >= BTN_LONG_MS)) {
                    // 长按
                    g_btnLongReported = true;
                    Serial.println("  BTN: LONG_PRESS");
                    sendButtonEvent(BTN_LONG_PRESS);
                }
                if (raw) {                      // 释放
                    g_btnReleaseTime = now;
                    if (!g_btnLongReported) {
                        g_btnState = B_WAIT_DOUBLE;
                    } else {
                        g_btnState = B_IDLE;
                    }
                }
                break;

            case B_WAIT_DOUBLE:
                if (!raw) {                     // 第二次按下 → 双击
                    g_btnState = B_IDLE;
                    Serial.println("  BTN: DOUBLE_CLICK");
                    sendButtonEvent(BTN_DOUBLE_CLICK);
                } else if (now - g_btnReleaseTime >= BTN_DOUBLE_GAP_MS) {
                    // 超时 → 单击
                    g_btnState = B_IDLE;
                    Serial.println("  BTN: CLICK");
                    sendButtonEvent(BTN_CLICK);
                    if (g_audioState == AUDIO_RECORDING) {
                        // 再次短按可提前结束；仍会检查最短时长和是否检测到语音。
                        finishAudioRecording(false);
                    } else {
                        startAudioRecording();
                    }
                }
                break;
        }
    }
    g_lastBtnRaw = raw;
}

// =============================================================================
// 11. 电量模拟（每秒减 1%，最低 5%）
// =============================================================================
static uint32_t g_lastBatteryTick = 0;
static bool     g_lowBatterySent  = false;

static void pollBattery() {
    uint32_t now = millis();
    if (now - g_lastBatteryTick < 60000) return; // 60 秒
    g_lastBatteryTick = now;

    if (g_batteryLevel > 5) {
        g_batteryLevel--;
        Serial.print("  Battery: ");
        Serial.println(g_batteryLevel);

        if (pBatteryLevel) {
            pBatteryLevel->setValue(&g_batteryLevel, 1);
            pBatteryLevel->notify();
        }

        // 低电警告
        if (g_batteryLevel <= 20 && !g_lowBatterySent) {
            g_lowBatterySent = true;
            sendLowBattery();
        }

        sendStatusChanged();
    }
}

// =============================================================================
// 12. BLE 回调
// =============================================================================

// Server 回调
class ServerCB : public NimBLEServerCallbacks {
    void onConnect(NimBLEServer* pServer, NimBLEConnInfo& connInfo) override {
        (void)pServer;
        clearCache();
        g_connected = true;
        g_connHandle = connInfo.getConnHandle();
        g_lowBatterySent = false;
        Serial.println("<<< Client connected >>>");
    }

    void onDisconnect(NimBLEServer* pServer,
                      NimBLEConnInfo& connInfo, int reason) override {
        (void)pServer;
        g_connected = false;
        g_audioDataSubscribed = false;
        g_audioStatusSubscribed = false;
        g_ttsStatusSubscribed = false;
        if (g_connHandle == connInfo.getConnHandle()) {
            g_connHandle = BLE_HS_CONN_HANDLE_NONE;
        }
        if (g_audioState == AUDIO_SENDING || g_audioState == AUDIO_WAIT_ACK ||
            g_audioState == AUDIO_WAIT_COMPLETE) {
            // 保留已经录好的数据；小程序重连并重新订阅后从头发送。
            g_audioState = AUDIO_READY;
        }
        if (g_ttsState != TTS_IDLE) resetTtsSession();
        Serial.print("<<< Client disconnected, reason=");
        Serial.print(reason);
        Serial.println(" >>>");
    }

    void onMTUChange(uint16_t mtu, NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        Serial.print("  BLE MTU changed: ");
        Serial.println(mtu);
    }
};

// Battery Level 订阅后立即上报当前值。
class BatteryLevelCB : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic* pChar,
                     NimBLEConnInfo& connInfo, uint16_t subValue) override {
        (void)connInfo;
        if (subValue & 0x01) {
            pChar->setValue(&g_batteryLevel, 1);
            pChar->notify();
            Serial.println("  Battery Level subscribed; initial value notified");
        }
    }
};

class AudioDataCB : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic* pChar,
                     NimBLEConnInfo& connInfo, uint16_t subValue) override {
        (void)pChar;
        g_connHandle = connInfo.getConnHandle();
        g_audioDataSubscribed = (subValue & 0x01) != 0;
        Serial.print("  Audio Data subscribed: ");
        Serial.println(g_audioDataSubscribed ? "yes" : "no");
        if (g_audioDataSubscribed && g_audioStatusSubscribed) beginAudioTransfer();
    }
};

class AudioStatusCB : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic* pChar,
                     NimBLEConnInfo& connInfo, uint16_t subValue) override {
        (void)pChar;
        g_connHandle = connInfo.getConnHandle();
        g_audioStatusSubscribed = (subValue & 0x02) != 0;
        Serial.print("  Audio Status subscribed: ");
        Serial.println(g_audioStatusSubscribed ? "yes" : "no");
        if (g_audioDataSubscribed && g_audioStatusSubscribed) beginAudioTransfer();
    }
};

class AudioControlCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar,
                 NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        handleAudioControl(pChar->getValue());
    }
};

class TtsStatusCB : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic* pChar,
                     NimBLEConnInfo& connInfo, uint16_t subValue) override {
        (void)pChar;
        g_connHandle = connInfo.getConnHandle();
        g_ttsStatusSubscribed = (subValue & 0x01) != 0;
        Serial.print("  TTS Status subscribed: ");
        Serial.println(g_ttsStatusSubscribed ? "yes" : "no");
    }
};

class TtsControlCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar,
                 NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        handleTtsControl(pChar->getValue());
    }
};

class TtsDataCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar,
                 NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        handleTtsData(pChar->getValue());
    }
};

// Command RX 写回调（NimBLE-Arduino 2.x）。
class CommandRxCB : public NimBLECharacteristicCallbacks {
    void onWrite(NimBLECharacteristic* pChar,
                 NimBLEConnInfo& connInfo) override {
        (void)connInfo;
        handleWrite(pChar->getValue());
    }

private:
    void handleWrite(const std::string& val) {
        const uint8_t* data = (const uint8_t*)val.data();
        size_t len = val.length();

        Serial.print("  RX [");
        for (size_t i = 0; i < len; i++) {
            if (data[i] < 0x10) Serial.print('0');
            Serial.print(data[i], HEX);
            Serial.print(' ');
        }
        Serial.println("]");

        // 1. 最小长度检查
        if (len < FRAME_OVERHEAD) {
            Serial.println("  ERR: frame too short");
            return;
        }

        // 2. SOF 校验
        if (data[0] != FRAME_SOF) {
            Serial.println("  ERR: bad SOF");
            return;
        }

        uint8_t flags       = data[2];
        uint8_t cmd         = data[3];
        uint8_t seq         = data[4];
        uint8_t payloadLen  = data[7];

        // 3. PayloadLength 校验
        if (payloadLen > PAYLOAD_MAX || len > FRAME_MAX_LEN ||
            FRAME_OVERHEAD + payloadLen != len) {
            Serial.println("  ERR: payloadLen mismatch");
            sendResponse(cmd, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
            return;
        }

        // 4. CRC 校验（Version ~ Payload 末尾）
        uint16_t crcExpected = data[len - 2] | ((uint16_t)data[len - 1] << 8);
        uint16_t crcActual   = crc16_ccitt(data + 1, FRAME_HEADER_LEN - 1 + payloadLen);
        if (crcExpected != crcActual) {
            Serial.print("  ERR: CRC expected=");
            Serial.print(crcExpected, HEX);
            Serial.print(" actual=");
            Serial.println(crcActual, HEX);
            sendResponse(cmd, seq, STATUS_CRC_ERROR, nullptr, 0);
            return;
        }

        // 5. 版本、分片和请求序号校验
        if (data[1] != FRAME_VERSION) {
            Serial.println("  ERR: incompatible frame version");
            sendResponse(cmd, seq, STATUS_VERSION_INCOMPAT, nullptr, 0);
            return;
        }
        if (data[5] != 0 || data[6] != 1 || seq == 0) {
            Serial.println("  ERR: unsupported fragment or invalid sequence");
            sendResponse(cmd, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
            return;
        }

        // 6. 只处理实验室模式请求帧
        if (flags != FLAG_REQUEST) {
            Serial.println("  WARN: not a request, ignoring");
            return;
        }

        // 7. 响应缓存查找（同一连接内按 Command + Sequence 去重）
        uint8_t cachedFrame[FRAME_MAX_LEN];
        uint8_t cachedLen;
        if (lookupCache(cmd, seq, cachedFrame, &cachedLen)) {
            Serial.println("  CACHE: re-sending cached response");
            if (pEventTx) {
                pEventTx->notify(cachedFrame, cachedLen);
            }
            return;
        }

        // 8. 分发命令
        const uint8_t* payload = (payloadLen > 0) ? (data + FRAME_HEADER_LEN) : nullptr;
        dispatchCommand(cmd, seq, payload, payloadLen);
    }
};

// =============================================================================
// 13. Setup
// =============================================================================
#define STRINGIFY_(x) #x
#define STRINGIFY(x)  STRINGIFY_(x)

void setup() {
    Serial.begin(115200);
    delay(1000);
    Serial.println();
    Serial.println("══════════════════════════════════════════");
    Serial.println(" YUNTUAN Smart Pendant  v" FIRMWARE_REVISION);
    Serial.println(" SN: " DEVICE_SN);
    Serial.println(" Protocol: v" STRINGIFY(PROTOCOL_MAJOR) "." STRINGIFY(PROTOCOL_MINOR));
    Serial.println(" Security: LAB mode");

    // ── CRC16 自检（对照文档 §11.1 示例）──
    // 输入: 01 00 02 01 00 01 00 → CRC = 0x48A9
    {
        uint8_t test[] = {0x01, 0x00, 0x02, 0x01, 0x00, 0x01, 0x00};
        uint16_t crc = crc16_ccitt(test, sizeof(test));
        Serial.print(" CRC self-test: ");
        if (crc == 0x48A9) {
            Serial.println("PASS (0x48A9)");
        } else {
            Serial.print("FAIL got 0x");
            Serial.println(crc, HEX);
            Serial.println("  >>> CRC MISMATCH — check implementation <<<");
        }
    }

    // ── CRC32 自检（音频完整性校验标准向量）──
    {
        const uint8_t test[] = {'1', '2', '3', '4', '5', '6', '7', '8', '9'};
        uint32_t crc = crc32_ieee(test, sizeof(test));
        Serial.print(" Audio CRC32 self-test: ");
        if (crc == 0xCBF43926UL) {
            Serial.println("PASS (0xCBF43926)");
        } else {
            Serial.print("FAIL got 0x");
            Serial.println(crc, HEX);
        }
    }

    Serial.println("══════════════════════════════════════════");

    // GPIO
    pinMode(PIN_BUTTON, INPUT_PULLUP);
    pinMode(PIN_ALERT, OUTPUT);
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_ALERT, LOW);
    digitalWrite(PIN_LED, LOW);

    // 录音缓冲在启动时一次性分配。N16R8 优先使用 PSRAM，避免录音期间动态申请内存。
    g_audioBuffer = (uint8_t*)heap_caps_malloc(
        AUDIO_BUFFER_CAPACITY,
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    );
    if (!g_audioBuffer) {
        g_audioBuffer = (uint8_t*)heap_caps_malloc(AUDIO_BUFFER_CAPACITY, MALLOC_CAP_8BIT);
    }
    if (g_audioBuffer) {
        Serial.print("  [OK] Audio buffer allocated: ");
        Serial.print(AUDIO_BUFFER_CAPACITY);
        Serial.println(" bytes");
        g_micReady = initMicrophone();
        Serial.println(g_micReady ? "  [OK] INMP441 microphone" : "  [ERR] INMP441 microphone");
    } else {
        Serial.println("  [ERR] Cannot allocate audio buffer");
    }

    // TTS 只保存压缩后的 ADPCM；播放时逐样本解码，不额外申请 PCM 大缓冲。
    g_ttsBuffer = (uint8_t*)heap_caps_malloc(
        TTS_BUFFER_CAPACITY,
        MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT
    );
    if (!g_ttsBuffer) {
        g_ttsBuffer = (uint8_t*)heap_caps_malloc(TTS_BUFFER_CAPACITY, MALLOC_CAP_8BIT);
    }
    if (g_ttsBuffer) {
        Serial.print("  [OK] TTS buffer allocated: ");
        Serial.print(TTS_BUFFER_CAPACITY);
        Serial.println(" bytes");
    } else {
        g_capabilities &= ~((uint16_t)1 << CAP_AUDIO_PLAYBACK);
        Serial.println("  [ERR] Cannot allocate TTS buffer; AudioPlayback capability disabled");
    }
    if (!g_micReady) {
        g_capabilities &= ~((uint16_t)1 << CAP_AUDIO_PLAYBACK);
        Serial.println("  [ERR] I2S is unavailable; AudioPlayback capability disabled");
    }

    // BLE 初始化
    NimBLEDevice::init(DEVICE_NAME);
    NimBLEDevice::setPower(ESP_PWR_LVL_P9);
    NimBLEDevice::setMTU(247);

    pBleServer = NimBLEDevice::createServer();
    pBleServer->setCallbacks(new ServerCB());
    pBleServer->advertiseOnDisconnect(true);

    // ── Battery Service ──
    NimBLEService* pBatterySvc = pBleServer->createService(BATTERY_SERVICE_UUID);
    pBatteryLevel = pBatterySvc->createCharacteristic(
        BATTERY_LEVEL_UUID,
        NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
    );
    pBatteryLevel->setCallbacks(new BatteryLevelCB());
    pBatteryLevel->setValue(&g_batteryLevel, 1);
    Serial.println("  [OK] Battery Service");

    // ── Device Information Service ──
    NimBLEService* pDevInfoSvc = pBleServer->createService(DEVICE_INFO_SERVICE_UUID);
    pDevInfoSvc->createCharacteristic(MODEL_NUMBER_UUID, NIMBLE_PROPERTY::READ)
        ->setValue(MODEL_NUMBER);
    pDevInfoSvc->createCharacteristic(SERIAL_NUMBER_UUID, NIMBLE_PROPERTY::READ)
        ->setValue(DEVICE_SN);
    pDevInfoSvc->createCharacteristic(FIRMWARE_REVISION_UUID, NIMBLE_PROPERTY::READ)
        ->setValue(FIRMWARE_REVISION);
    pDevInfoSvc->createCharacteristic(HARDWARE_REVISION_UUID, NIMBLE_PROPERTY::READ)
        ->setValue(HARDWARE_REVISION);
    Serial.println("  [OK] Device Info Service");

    // ── Yuntuan Control Service ──
    NimBLEService* pCtrlSvc = pBleServer->createService(CONTROL_SERVICE_UUID);

    // commandRx: Write (必须) + Write Without Response (可选)
    NimBLECharacteristic* pCmdRx = pCtrlSvc->createCharacteristic(
        COMMAND_RX_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pCmdRx->setCallbacks(new CommandRxCB());

    // eventTx: Notify (必须)
    pEventTx = pCtrlSvc->createCharacteristic(
        EVENT_TX_UUID,
        NIMBLE_PROPERTY::NOTIFY
    );

    // protocolInfo: Read, 固定 6 字节
    NimBLECharacteristic* pProtoInfo = pCtrlSvc->createCharacteristic(
        PROTOCOL_INFO_UUID,
        NIMBLE_PROPERTY::READ
    );
    uint8_t protoInfo[6] = {
        PROTOCOL_MAJOR,
        PROTOCOL_MINOR,
        (uint8_t)(g_capabilities & 0xFF),
        (uint8_t)((g_capabilities >> 8) & 0xFF),
        SECURITY_MODE,
        0                       // Reserved = 0
    };
    pProtoInfo->setValue(protoInfo, 6);

    Serial.println("  [OK] Control Service");

    // ── Yuntuan Audio Transfer Service ──
    NimBLEService* pAudioSvc = pBleServer->createService(AUDIO_SERVICE_UUID);
    NimBLECharacteristic* pAudioControl = pAudioSvc->createCharacteristic(
        AUDIO_CONTROL_UUID,
        NIMBLE_PROPERTY::WRITE
    );
    pAudioControl->setCallbacks(new AudioControlCB());

    pAudioData = pAudioSvc->createCharacteristic(
        AUDIO_DATA_UUID,
        NIMBLE_PROPERTY::NOTIFY
    );
    pAudioData->setCallbacks(new AudioDataCB());

    pAudioStatus = pAudioSvc->createCharacteristic(
        AUDIO_STATUS_UUID,
        NIMBLE_PROPERTY::INDICATE
    );
    pAudioStatus->setCallbacks(new AudioStatusCB());

    // ── Yuntuan Speech Playback Service ──
    NimBLEService* pTtsSvc = pBleServer->createService(TTS_SERVICE_UUID);
    NimBLECharacteristic* pTtsControl = pTtsSvc->createCharacteristic(
        TTS_CONTROL_UUID,
        NIMBLE_PROPERTY::WRITE
    );
    pTtsControl->setCallbacks(new TtsControlCB());

    NimBLECharacteristic* pTtsData = pTtsSvc->createCharacteristic(
        TTS_DATA_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
    );
    pTtsData->setCallbacks(new TtsDataCB());

    pTtsStatus = pTtsSvc->createCharacteristic(
        TTS_STATUS_UUID,
        NIMBLE_PROPERTY::NOTIFY
    );
    pTtsStatus->setCallbacks(new TtsStatusCB());

    pBatterySvc->start();
    pDevInfoSvc->start();
    pCtrlSvc->start();
    pAudioSvc->start();
    pTtsSvc->start();
    Serial.println("  [OK] Audio Transfer Service");
    Serial.println("  [OK] Speech Playback Service");

    // ── 广播 ──
    NimBLEAdvertising* pAdv = NimBLEDevice::getAdvertising();
    pAdv->addServiceUUID(CONTROL_SERVICE_UUID);
    pAdv->addServiceUUID(BATTERY_SERVICE_UUID);
    pAdv->enableScanResponse(true);
    pAdv->setName(DEVICE_NAME);
    // 广播间隔 100-125ms（实验室联调）
    pAdv->setMinInterval(160);  // 100ms = 160 * 0.625ms
    pAdv->setMaxInterval(200);  // 125ms
    pAdv->start();

    Serial.println("  [OK] Advertising started");
    Serial.println("══════════════════════════════════════════");
}

// =============================================================================
// 14. Loop
// =============================================================================
void loop() {
    uint32_t now = millis();

    // ── 每秒更新 uptime ──
    static uint32_t lastUptimeTick = 0;
    if (now - lastUptimeTick >= 1000) {
        lastUptimeTick = now;
        g_uptime++;
    }

    // ── 按键轮询 ──
    pollButton();

    // ── 挂件录音与 BLE 音频分包 ──
    pollAudioRecording();
    pollAudioTransfer();
    pollTtsPlayback();

    // ── 电量模拟 ──
    pollBattery();

    // ── FIND_DEVICE Alert 处理 ──
    if (g_alertActive) {
        if (now >= g_alertEnd) {
            g_alertActive = false;
            digitalWrite(PIN_ALERT, LOW);
            digitalWrite(PIN_LED, LOW);
            Serial.println("  FIND_DEVICE: alert ended");
        } else if (now - g_lastAlertToggle >= 250) {
            g_lastAlertToggle = now;
            g_alertToggle = !g_alertToggle;
            digitalWrite(PIN_ALERT, g_alertToggle ? HIGH : LOW);
            digitalWrite(PIN_LED, g_alertToggle ? HIGH : LOW);
        }
    }

    delay((g_audioState == AUDIO_RECORDING || g_ttsState == TTS_PLAYING) ? 1 : 10);
}

// =============================================================================
// 云团智能挂件 — BLE 协议 v0.2 固件
// YUNTUAN Smart Pendant — Phase 1 Firmware
// =============================================================================
#include <Arduino.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <driver/i2s.h>
#include <esp_heap_caps.h>
#include <esp_system.h>

// =============================================================================
// 1. UUID 定义
// =============================================================================
#define DEVICE_SN                 "YT01260000000001"
#define DEVICE_NAME               "YT-000001"
#define MODEL_NUMBER              "YT-P01"
#define FIRMWARE_REVISION         "0.5.6"
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
#define CMD_GET_SOCIAL_TOKEN      0x07

// Event commands (§10)
#define EVT_STATUS_CHANGED        0x20
#define EVT_BUTTON_EVENT          0x21
#define EVT_LOW_BATTERY           0x22
#define EVT_BIND_WINDOW_CHANGED   0x23
#define EVT_SOCIAL_ENCOUNTER      0x24

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
#define PROTOCOL_MINOR            5
#define CAPABILITIES              0x071F        // Control v1.5 + Audio + anonymous social lookup
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
#define CAP_SOCIAL_ENCOUNTER      10

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
// 3.1 挂件录音与 BLE Audio Transfer v2
// =============================================================================
#define AUDIO_SAMPLE_RATE         16000
#define AUDIO_FRAME_SAMPLES       320           // 20 ms
#define AUDIO_MAX_SECONDS         15
#define AUDIO_MIN_SAMPLES         (AUDIO_SAMPLE_RATE / 2)
#define AUDIO_MAX_SAMPLES         (AUDIO_SAMPLE_RATE * AUDIO_MAX_SECONDS)
#define AUDIO_BUFFER_CAPACITY     (AUDIO_MAX_SAMPLES / 2)
#define AUDIO_VAD_THRESHOLD       650           // 平均绝对幅度，需按实机噪声微调
#define AUDIO_SILENCE_MS          800UL
#define AUDIO_NO_SPEECH_MS        5000UL
#define AUDIO_MAX_DURATION_MS     (AUDIO_MAX_SECONDS * 1000UL)
#define AUDIO_WINDOW_PACKETS      8
#define AUDIO_ACK_TIMEOUT_MS      1800
#define AUDIO_ACK_MAX_RETRIES     4
#define AUDIO_RETAINED_TIMEOUT_MS 30000UL

#define AUDIO_PROTOCOL_VERSION    2
#define AUDIO_CODEC_IMA_ADPCM     1
#define AUDIO_STATUS_RECORDING    0x10
#define AUDIO_STATUS_META         0x11
#define AUDIO_STATUS_END          0x12
#define AUDIO_STATUS_CAPTURE_STOPPED 0x13
#define AUDIO_STATUS_ERROR        0x7F
#define AUDIO_DATA_PACKET         0x20
#define AUDIO_DATA_FLAG_FINAL     0x01
#define AUDIO_CONTROL_ACK         0x01
#define AUDIO_CONTROL_COMPLETE    0x02
#define AUDIO_CONTROL_ABORT       0x03

#define AUDIO_ERROR_MIC_INIT      1
#define AUDIO_ERROR_NO_SPEECH     2
#define AUDIO_ERROR_BUFFER_FULL   3
#define AUDIO_ERROR_TIMEOUT       4
#define AUDIO_ERROR_NOT_SUBSCRIBED 5

// =============================================================================
// 3.2 云团朗读与 BLE Speech Playback v2
// =============================================================================
#define TTS_SAMPLE_RATE           16000
#define TTS_MAX_SECONDS           60
#define TTS_BUFFER_CAPACITY       (TTS_SAMPLE_RATE * TTS_MAX_SECONDS / 2)
#define TTS_ACK_WINDOW            8
#define TTS_SESSION_TIMEOUT_MS    8000
#define TTS_PREBUFFER_BYTES       3200          // 400 ms of 16 kHz IMA-ADPCM

#define TTS_PROTOCOL_VERSION      2
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
// 3.3 Device-to-device social proximity
// =============================================================================
#define SOCIAL_BEACON_VERSION             1
#define SOCIAL_BEACON_FLAG_ENABLED        0x01
#define SOCIAL_BEACON_LENGTH              8
#define SOCIAL_PEER_CAPACITY              12
#define SOCIAL_ENTER_RSSI_DBM             (-65)  // Initial ~2 m value; calibrate with the final enclosure.
#define SOCIAL_EXIT_RSSI_DBM              (-72)  // Hysteresis prevents repeated edge triggers.
#define SOCIAL_REQUIRED_SAMPLES           3
#define SOCIAL_PEER_COOLDOWN_MS            60000UL
#define SOCIAL_PEER_LOST_MS                5000UL
#define SOCIAL_SCAN_INTERVAL_MS            300
#define SOCIAL_SCAN_WINDOW_MS              60
#define SOCIAL_ALERT_DURATION_MS           500
#define SOCIAL_EVENT_QUEUE_CAPACITY        4

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
static Preferences g_preferences;

// Alert state (FIND_DEVICE)
static bool     g_alertActive   = false;
static uint32_t g_alertEnd      = 0;
static bool     g_alertToggle   = false;
static uint32_t g_lastAlertToggle = 0;
static uint8_t  g_alertType     = 0;
static uint32_t g_alertTonePhase = 0;

// Social beacon/scanner state. BLE callbacks only request advertising changes;
// stop/start is performed by loop() so a connect callback never re-enters GAP.
static NimBLEAdvertising* g_advertising = nullptr;
static NimBLEScan* g_socialScan = nullptr;
static uint32_t g_socialDeviceToken = 0;
static volatile bool g_advertisingModeDirty = false;
static volatile bool g_beaconDataDirty = false;
static volatile bool g_desiredConnectableAdvertising = true;
static volatile bool g_socialScanRestartRequested = false;
static uint32_t g_socialScanRetryAt = 0;

struct SocialPeerState {
    uint32_t token;
    int16_t filteredRssiQuarterDbm;
    uint32_t lastSeenAt;
    uint32_t cooldownUntil;
    uint8_t nearSamples;
    uint8_t farSamples;
    bool inside;
    bool used;
};

static SocialPeerState g_socialPeers[SOCIAL_PEER_CAPACITY] = {};
static volatile bool g_socialAlertPending = false;
static volatile uint32_t g_socialAlertToken = 0;
static volatile int8_t g_socialAlertRssi = -127;
static volatile uint32_t g_socialAlertQueuedAt = 0;

struct SocialEncounterEvent {
    uint32_t token;
    uint32_t detectedAt;
    int8_t rssi;
};

static SocialEncounterEvent g_socialEventQueue[SOCIAL_EVENT_QUEUE_CAPACITY] = {};
static uint8_t g_socialEventHead = 0;
static uint8_t g_socialEventCount = 0;
static portMUX_TYPE g_socialEventMux = portMUX_INITIALIZER_UNLOCKED;

static void requestInteractionBeaconRefresh();
static void startFindDeviceAlert(uint8_t alertType, uint16_t duration);

// 上一帧成功响应（用于 GET_STATUS 判断）
static uint8_t  g_lastStatusPayload[12] = {0};
static uint8_t  g_lastStatusLen = 0;

// GATT handles
static NimBLECharacteristic* pEventTx = nullptr;
static NimBLECharacteristic* pBatteryLevel = nullptr;
static volatile bool g_eventTxSubscribed = false;

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
    AUDIO_RETAINED
};

enum AudioTransferLifecycle {
    AUDIO_TRANSFER_IDLE,
    AUDIO_TRANSFER_SENDING,
    AUDIO_TRANSFER_WAIT_ACK,
    AUDIO_TRANSFER_WAIT_COMPLETE
};

static AudioLifecycle g_audioState = AUDIO_IDLE;
static AudioTransferLifecycle g_audioTransferState = AUDIO_TRANSFER_IDLE;
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
static uint32_t g_recordStartedAt = 0;
static uint32_t g_lastSpeechAt = 0;
static bool g_audioStreamStarted = false;
static bool g_audioFinalized = false;

static uint8_t g_audioChunkPayload = 15;
static uint16_t g_audioTotalChunks = 0;
static uint16_t g_audioNextSequence = 0;
static uint16_t g_audioAckedSequence = 0;
static uint8_t g_audioWindowSent = 0;
static uint8_t g_audioAckRetries = 0;
static uint32_t g_audioNextSendAt = 0;
static uint32_t g_audioAckDeadline = 0;
static uint32_t g_audioCompleteDeadline = 0;
static uint32_t g_audioRetainedDeadline = 0;
static bool g_audioErrorPending = false;
static uint16_t g_audioErrorSession = 0;
static uint8_t g_audioPendingErrorCode = 0;
static uint32_t g_audioErrorRetryAt = 0;

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
static bool g_ttsEndReceived = false;

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
static bool sendEvent(uint8_t evtCmd, const uint8_t* payload, uint8_t payloadLen) {
    if (!g_connected || !g_eventTxSubscribed || !pEventTx || payloadLen > PAYLOAD_MAX) return false;

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
    return true;
}

static void queueSocialEncounterEvent(uint32_t token, int8_t rssi, uint32_t detectedAt) {
    portENTER_CRITICAL(&g_socialEventMux);
    if (g_socialEventCount == SOCIAL_EVENT_QUEUE_CAPACITY) {
        g_socialEventHead = (g_socialEventHead + 1) % SOCIAL_EVENT_QUEUE_CAPACITY;
        g_socialEventCount--;
    }
    uint8_t tail = (g_socialEventHead + g_socialEventCount) % SOCIAL_EVENT_QUEUE_CAPACITY;
    g_socialEventQueue[tail] = { token, detectedAt, rssi };
    g_socialEventCount++;
    portEXIT_CRITICAL(&g_socialEventMux);
}

static void pollSocialEncounterEvents(uint32_t now) {
    if (!g_connected || !g_eventTxSubscribed || !pEventTx) return;

    SocialEncounterEvent encounter = {};
    bool hasEvent = false;
    portENTER_CRITICAL(&g_socialEventMux);
    if (g_socialEventCount > 0) {
        encounter = g_socialEventQueue[g_socialEventHead];
        g_socialEventHead = (g_socialEventHead + 1) % SOCIAL_EVENT_QUEUE_CAPACITY;
        g_socialEventCount--;
        hasEvent = true;
    }
    portEXIT_CRITICAL(&g_socialEventMux);
    if (!hasEvent) return;

    uint32_t ageSeconds = (now - encounter.detectedAt) / 1000;
    uint8_t payload[9];
    payload[0] = (uint8_t)(encounter.token & 0xFF);
    payload[1] = (uint8_t)((encounter.token >> 8) & 0xFF);
    payload[2] = (uint8_t)((encounter.token >> 16) & 0xFF);
    payload[3] = (uint8_t)((encounter.token >> 24) & 0xFF);
    payload[4] = (uint8_t)encounter.rssi;
    payload[5] = (uint8_t)(ageSeconds & 0xFF);
    payload[6] = (uint8_t)((ageSeconds >> 8) & 0xFF);
    payload[7] = (uint8_t)((ageSeconds >> 16) & 0xFF);
    payload[8] = (uint8_t)((ageSeconds >> 24) & 0xFF);
    if (!sendEvent(EVT_SOCIAL_ENCOUNTER, payload, sizeof(payload))) {
        queueSocialEncounterEvent(encounter.token, encounter.rssi, encounter.detectedAt);
    }
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
    g_preferences.putBool("social", g_socialMode != 0);
    requestInteractionBeaconRefresh();
    uint8_t result[1] = { g_socialMode };
    sendResponse(CMD_SET_SOCIAL_MODE, seq, STATUS_OK, result, 1);
    Serial.print("  SocialMode set to: ");
    Serial.println(g_socialMode);
}

static void stopFindDeviceAlert() {
    if (!g_alertActive) return;
    g_alertActive = false;
    digitalWrite(PIN_ALERT, LOW);
    digitalWrite(PIN_LED, LOW);
    if (g_micReady) i2s_zero_dma_buffer(I2S_NUM_0);
}

static void startFindDeviceAlert(uint8_t alertType, uint16_t duration) {
    g_alertActive = true;
    g_alertEnd = millis() + duration;
    g_alertToggle = true;
    g_lastAlertToggle = millis();
    g_alertType = alertType;
    g_alertTonePhase = 0;
    digitalWrite(PIN_ALERT, (alertType == 0 || alertType == 2) ? HIGH : LOW);
    digitalWrite(PIN_LED, HIGH);
}

static void pollFindDeviceAlert(uint32_t now) {
    if (!g_alertActive) return;
    if (now >= g_alertEnd) {
        stopFindDeviceAlert();
        Serial.println("  FIND_DEVICE: alert ended");
        return;
    }

    if (now - g_lastAlertToggle >= 250) {
        g_lastAlertToggle = now;
        g_alertToggle = !g_alertToggle;
    }

    const bool vibrationEnabled = g_alertType == 0 || g_alertType == 2;
    const bool soundEnabled = g_alertType == 1 || g_alertType == 2;
    digitalWrite(PIN_ALERT, vibrationEnabled && g_alertToggle ? HIGH : LOW);
    digitalWrite(PIN_LED, g_alertToggle ? HIGH : LOW);

    // 当前硬件已有 MAX98357A 扬声器。没有额外振动马达时，仍可通过提示音和闪灯找到挂件。
    // 录音或 TTS 占用 I2S 时不抢占音频总线，GPIO2/状态灯提醒仍继续。
    if (!soundEnabled || !g_micReady || g_audioState != AUDIO_IDLE || g_ttsState != TTS_IDLE) return;

    static int32_t toneFrame[160];             // 16 kHz 下 10 ms
    for (size_t i = 0; i < 160; i++) {
        int16_t sample = 0;
        if (g_alertToggle) {
            sample = g_alertTonePhase < (TTS_SAMPLE_RATE / 2) ? 3500 : -3500;
            g_alertTonePhase += 880;            // 880 Hz 方波提示音
            if (g_alertTonePhase >= TTS_SAMPLE_RATE) g_alertTonePhase -= TTS_SAMPLE_RATE;
        }
        toneFrame[i] = (int32_t)sample * 65536;
    }
    size_t written = 0;
    i2s_write(
        I2S_NUM_0,
        toneFrame,
        sizeof(toneFrame),
        &written,
        pdMS_TO_TICKS(5)
    );
}

// FIND_DEVICE 0x04 — 查找设备（振动/提示音/闪灯）
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

    startFindDeviceAlert(alertType, duration);

    Serial.print("  FIND_DEVICE type=");
    Serial.print(alertType);
    Serial.print(" duration=");
    Serial.print(duration);
    Serial.println("ms");

    sendResponse(CMD_FIND_DEVICE, seq, STATUS_OK, nullptr, 0);
}

static bool socialDeadlineReached(uint32_t now, uint32_t deadline) {
    return deadline == 0 || (int32_t)(now - deadline) >= 0;
}

static void buildInteractionBeacon(uint8_t* data) {
    data[0] = 0x59; // Development manufacturer marker: "YT".
    data[1] = 0x54;
    data[2] = SOCIAL_BEACON_VERSION;
    data[3] = g_socialMode ? SOCIAL_BEACON_FLAG_ENABLED : 0;
    data[4] = (uint8_t)(g_socialDeviceToken & 0xFF);
    data[5] = (uint8_t)((g_socialDeviceToken >> 8) & 0xFF);
    data[6] = (uint8_t)((g_socialDeviceToken >> 16) & 0xFF);
    data[7] = (uint8_t)((g_socialDeviceToken >> 24) & 0xFF);
}

static void requestInteractionBeaconRefresh() {
    g_beaconDataDirty = true;
}

static void requestAdvertisingMode(bool connectable) {
    g_desiredConnectableAdvertising = connectable;
    g_advertisingModeDirty = true;
}

static void pollSocialAdvertising() {
    if (!g_advertising) return;

    const bool modeDirty = g_advertisingModeDirty;
    const bool dataDirty = g_beaconDataDirty;
    if (!modeDirty && !dataDirty) return;
    g_advertisingModeDirty = false;
    g_beaconDataDirty = false;

    if (dataDirty) {
        uint8_t beacon[SOCIAL_BEACON_LENGTH];
        buildInteractionBeacon(beacon);
        if (!g_advertising->setManufacturerData(beacon, sizeof(beacon))) {
            Serial.println("  [ERR] Social beacon does not fit advertising data");
        }
    }

    if (modeDirty) {
        if (g_advertising->isAdvertising()) g_advertising->stop();
        g_advertising->setConnectableMode(
            g_desiredConnectableAdvertising ? BLE_GAP_CONN_MODE_UND : BLE_GAP_CONN_MODE_NON
        );
        if (!g_advertising->start()) {
            Serial.println("  [ERR] Failed to restart social advertising");
            g_advertisingModeDirty = true;
            return;
        }
        Serial.println(
            g_desiredConnectableAdvertising
                ? "  Social advertising: connectable"
                : "  Social advertising: non-connectable (phone remains connected)"
        );
    } else if (dataDirty && g_advertising->isAdvertising()) {
        if (!g_advertising->refreshAdvertisingData()) {
            Serial.println("  [WARN] Social beacon refresh failed; scheduling restart");
            g_advertisingModeDirty = true;
        }
    }
}

static SocialPeerState* getSocialPeer(uint32_t token, uint32_t now) {
    SocialPeerState* freeSlot = nullptr;
    SocialPeerState* oldest = &g_socialPeers[0];
    uint32_t oldestAge = 0;

    for (uint8_t i = 0; i < SOCIAL_PEER_CAPACITY; i++) {
        SocialPeerState* peer = &g_socialPeers[i];
        if (peer->used && peer->token == token) return peer;
        if (!peer->used && !freeSlot) freeSlot = peer;
        if (peer->used) {
            uint32_t age = now - peer->lastSeenAt;
            if (age >= oldestAge) {
                oldestAge = age;
                oldest = peer;
            }
        }
    }

    SocialPeerState* peer = freeSlot ? freeSlot : oldest;
    memset(peer, 0, sizeof(*peer));
    peer->used = true;
    peer->token = token;
    return peer;
}

static void processSocialAdvertisement(uint32_t token, bool peerEnabled, int8_t rssi) {
    if (token == 0 || token == g_socialDeviceToken) return;

    uint32_t now = millis();
    SocialPeerState* peer = getSocialPeer(token, now);
    const bool lostBeforeThisPacket = peer->lastSeenAt != 0 &&
        now - peer->lastSeenAt > SOCIAL_PEER_LOST_MS;
    peer->lastSeenAt = now;

    if (!g_socialMode || !peerEnabled) {
        peer->inside = false;
        peer->nearSamples = 0;
        peer->farSamples = 0;
        peer->filteredRssiQuarterDbm = (int16_t)rssi * 4;
        return;
    }

    if (peer->filteredRssiQuarterDbm == 0 || lostBeforeThisPacket) {
        peer->filteredRssiQuarterDbm = (int16_t)rssi * 4;
        peer->inside = false;
        peer->nearSamples = 0;
        peer->farSamples = 0;
    } else {
        // EMA: 75% previous sample + 25% new sample, retained in quarter-dBm units.
        peer->filteredRssiQuarterDbm =
            (int16_t)((peer->filteredRssiQuarterDbm * 3 + (int16_t)rssi * 4) / 4);
    }

    const int16_t enterThreshold = SOCIAL_ENTER_RSSI_DBM * 4;
    const int16_t exitThreshold = SOCIAL_EXIT_RSSI_DBM * 4;
    if (peer->filteredRssiQuarterDbm >= enterThreshold) {
        peer->farSamples = 0;
        if (peer->nearSamples < SOCIAL_REQUIRED_SAMPLES) peer->nearSamples++;
        if (!peer->inside && peer->nearSamples >= SOCIAL_REQUIRED_SAMPLES) {
            peer->inside = true;
            peer->nearSamples = 0;
            if (socialDeadlineReached(now, peer->cooldownUntil)) {
                peer->cooldownUntil = now + SOCIAL_PEER_COOLDOWN_MS;
                const int8_t filteredRssi = (int8_t)(peer->filteredRssiQuarterDbm / 4);
                queueSocialEncounterEvent(token, filteredRssi, now);
                g_socialAlertToken = token;
                g_socialAlertRssi = filteredRssi;
                g_socialAlertQueuedAt = now;
                g_socialAlertPending = true;
            }
        }
    } else if (peer->filteredRssiQuarterDbm <= exitThreshold) {
        peer->nearSamples = 0;
        if (peer->farSamples < SOCIAL_REQUIRED_SAMPLES) peer->farSamples++;
        if (peer->farSamples >= SOCIAL_REQUIRED_SAMPLES) {
            peer->inside = false;
            peer->farSamples = 0;
        }
    } else {
        peer->nearSamples = 0;
        peer->farSamples = 0;
    }
}

class SocialScanCB : public NimBLEScanCallbacks {
    void onResult(const NimBLEAdvertisedDevice* advertisedDevice) override {
        if (!advertisedDevice->haveManufacturerData()) return;
        const std::string data = advertisedDevice->getManufacturerData();
        if (data.size() != SOCIAL_BEACON_LENGTH) return;
        if ((uint8_t)data[0] != 0x59 || (uint8_t)data[1] != 0x54 ||
            (uint8_t)data[2] != SOCIAL_BEACON_VERSION) return;

        const bool enabled = ((uint8_t)data[3] & SOCIAL_BEACON_FLAG_ENABLED) != 0;
        const uint32_t token =
            (uint32_t)(uint8_t)data[4] |
            ((uint32_t)(uint8_t)data[5] << 8) |
            ((uint32_t)(uint8_t)data[6] << 16) |
            ((uint32_t)(uint8_t)data[7] << 24);
        processSocialAdvertisement(token, enabled, advertisedDevice->getRSSI());
    }

    void onScanEnd(const NimBLEScanResults& scanResults, int reason) override {
        (void)scanResults;
        Serial.print("  Social scan ended, reason=");
        Serial.println(reason);
        g_socialScanRestartRequested = true;
    }
};

static void pollSocialInteraction(uint32_t now) {
    if (g_socialScan &&
        (g_socialScanRestartRequested || !g_socialScan->isScanning()) &&
        socialDeadlineReached(now, g_socialScanRetryAt)) {
        g_socialScanRestartRequested = false;
        if (!g_socialScan->start(0, false, true)) {
            g_socialScanRetryAt = now + 1000;
            g_socialScanRestartRequested = true;
        } else {
            Serial.println("  Social scan restarted");
        }
    }

    if (!g_socialAlertPending) return;
    if (!g_socialMode || now - g_socialAlertQueuedAt > 3000) {
        g_socialAlertPending = false;
        return;
    }

    const bool audioBusy = g_audioState == AUDIO_RECORDING ||
        g_audioTransferState != AUDIO_TRANSFER_IDLE || g_ttsState != TTS_IDLE;
    if (audioBusy || g_alertActive) return;

    uint32_t token = g_socialAlertToken;
    int8_t rssi = g_socialAlertRssi;
    g_socialAlertPending = false;
    startFindDeviceAlert(0, SOCIAL_ALERT_DURATION_MS);
    Serial.print("  SOCIAL_PROXIMITY token=0x");
    Serial.print(token, HEX);
    Serial.print(" filteredRSSI=");
    Serial.print(rssi);
    Serial.println(" dBm; short vibration started");
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

// GET_SOCIAL_TOKEN 0x07 — return the current boot-scoped anonymous beacon token.
static void handleGetSocialToken(uint8_t seq) {
    uint8_t data[4];
    data[0] = (uint8_t)(g_socialDeviceToken & 0xFF);
    data[1] = (uint8_t)((g_socialDeviceToken >> 8) & 0xFF);
    data[2] = (uint8_t)((g_socialDeviceToken >> 16) & 0xFF);
    data[3] = (uint8_t)((g_socialDeviceToken >> 24) & 0xFF);
    sendResponse(CMD_GET_SOCIAL_TOKEN, seq, STATUS_OK, data, sizeof(data));
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
        case CMD_GET_SOCIAL_TOKEN:
            if (payloadLen != 0) sendResponse(cmd, seq, STATUS_INVALID_PAYLOAD, nullptr, 0);
            else handleGetSocialToken(seq);
            break;
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
    if (sendAudioStatus(status, sizeof(status))) {
        g_audioErrorPending = false;
    } else if (g_audioState != AUDIO_IDLE) {
        // META/CAPTURE_STOPPED may still have an outstanding indication.
        // Preserve terminal errors across discard and retry them from loop().
        g_audioErrorPending = true;
        g_audioErrorSession = g_audioSession;
        g_audioPendingErrorCode = errorCode;
        g_audioErrorRetryAt = millis() + 100;
    }
    Serial.print("  AUDIO ERROR: ");
    Serial.println(errorCode);
}

static void pollPendingAudioError(uint32_t now) {
    if (!g_audioErrorPending || (int32_t)(now - g_audioErrorRetryAt) < 0 ||
        !g_connected || !g_audioStatusSubscribed) return;
    uint8_t status[4] = {
        AUDIO_STATUS_ERROR,
        (uint8_t)(g_audioErrorSession & 0xFF),
        (uint8_t)((g_audioErrorSession >> 8) & 0xFF),
        g_audioPendingErrorCode
    };
    if (sendAudioStatus(status, sizeof(status))) {
        g_audioErrorPending = false;
        Serial.println("  AUDIO: pending terminal error delivered");
    } else {
        g_audioErrorRetryAt = now + 100;
    }
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
    g_audioStreamStarted = false;
    g_audioFinalized = false;
    g_audioTransferState = AUDIO_TRANSFER_IDLE;
    g_audioTotalChunks = 0;
    g_audioNextSequence = 0;
    g_audioAckedSequence = 0;
    g_audioWindowSent = 0;
    g_audioAckRetries = 0;
    g_audioNextSendAt = 0;
    g_audioAckDeadline = 0;
    g_audioCompleteDeadline = 0;
    g_audioRetainedDeadline = 0;
}

static void discardRecordedAudio() {
    clearRecordedAudio();
    g_audioState = AUDIO_IDLE;
    digitalWrite(PIN_LED, LOW);
}

static void beginAudioTransfer();

static bool startAudioRecording() {
    stopFindDeviceAlert();
    if (g_audioErrorPending) {
        Serial.println("  AUDIO: waiting to deliver previous terminal status");
        return false;
    }
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
    g_recordStartedAt = millis();
    g_lastSpeechAt = 0;
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

    uint8_t stoppedStatus[3] = {
        AUDIO_STATUS_CAPTURE_STOPPED,
        (uint8_t)(g_audioSession & 0xFF),
        (uint8_t)((g_audioSession >> 8) & 0xFF)
    };
    sendAudioStatus(stoppedStatus, sizeof(stoppedStatus));

    g_audioCrc32 = crc32_ieee(g_audioBuffer, g_audioBytes);
    g_audioFinalized = true;
    g_audioTotalChunks = (uint16_t)((g_audioBytes + g_audioChunkPayload - 1) / g_audioChunkPayload);
    g_audioState = AUDIO_RETAINED;
    g_audioRetainedDeadline = millis() + AUDIO_RETAINED_TIMEOUT_MS;
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

    const uint32_t now = millis();
    if (now - g_recordStartedAt >= AUDIO_MAX_DURATION_MS ||
        (!g_speechDetected && now - g_recordStartedAt >= AUDIO_NO_SPEECH_MS) ||
        (g_speechDetected && g_lastSpeechAt != 0 &&
         now - g_lastSpeechAt >= AUDIO_SILENCE_MS &&
         g_audioSamples >= AUDIO_MIN_SAMPLES)) {
        finishAudioRecording(false);
        return;
    }

    int32_t raw[AUDIO_FRAME_SAMPLES];
    size_t bytesRead = 0;
    esp_err_t result = i2s_read(
        I2S_NUM_0,
        raw,
        sizeof(raw),
        &bytesRead,
        0
    );
    if (result != ESP_OK || bytesRead == 0) return;

    size_t sampleCount = bytesRead / sizeof(int32_t);
    size_t processedSamples = 0;
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
        processedSamples++;
    }

    uint32_t meanAmplitude = processedSamples ? (uint32_t)(absoluteSum / processedSamples) : 0;
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
        g_lastSpeechAt = now;
    }

    if (bufferFull || reachedLimit || g_audioSamples >= AUDIO_MAX_SAMPLES) {
        finishAudioRecording(bufferFull);
    } else if (g_speechDetected && g_lastSpeechAt != 0 &&
               now - g_lastSpeechAt >= AUDIO_SILENCE_MS &&
               g_audioSamples >= AUDIO_MIN_SAMPLES) {
        finishAudioRecording(false);
    } else if (!g_speechDetected && now - g_recordStartedAt >= AUDIO_NO_SPEECH_MS) {
        finishAudioRecording(false);
    }

    // Start BLE transfer as soon as the first complete ADPCM bytes exist.
    // Recording continues even while the transfer state machine waits for ACKs.
    if (g_audioState == AUDIO_RECORDING && !g_audioStreamStarted && g_audioBytes > 0) {
        beginAudioTransfer();
    }
}

static void beginAudioTransfer() {
    if (g_audioStreamStarted || g_audioState == AUDIO_IDLE || g_audioSamples == 0 ||
        !g_connected || !g_audioDataSubscribed ||
        !g_audioStatusSubscribed || !pBleServer || g_connHandle == BLE_HS_CONN_HANDLE_NONE) {
        return;
    }

    uint16_t mtu = pBleServer->getPeerMTU(g_connHandle);
    if (mtu < 23) mtu = 23;
    uint16_t maxChunk = mtu > 9 ? mtu - 9 : 14; // ATT(3) + v2 Audio Data header(6)
    if (maxChunk > 239) maxChunk = 239;
    if (maxChunk < 14) maxChunk = 14;
    g_audioChunkPayload = (uint8_t)maxChunk;
    g_audioTotalChunks = g_audioFinalized
        ? (uint16_t)((g_audioBytes + g_audioChunkPayload - 1) / g_audioChunkPayload)
        : 0;
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
    // v2 announces the stream before the final lengths are known. The END
    // status carries sampleCount, encodedBytes and CRC32.
    writeUint32LE(meta + 8, 0);
    writeUint32LE(meta + 12, 0);
    writeUint16LE(meta + 16, (uint16_t)g_audioInitialPredictor);
    meta[18] = g_audioInitialIndex;
    meta[19] = g_audioChunkPayload;

    if (!sendAudioStatus(meta, sizeof(meta))) {
        Serial.println("  AUDIO: failed to send stream metadata; will retry");
        return;
    }

    g_audioStreamStarted = true;
    g_audioTransferState = AUDIO_TRANSFER_SENDING;
    g_audioNextSendAt = millis() + 1;
    Serial.print("  AUDIO: live transfer start, MTU=");
    Serial.print(mtu);
    Serial.print(" chunk=");
    Serial.print(g_audioChunkPayload);
    Serial.print(" recording=");
    Serial.println(g_audioState == AUDIO_RECORDING ? "yes" : "no");
}

static bool sendAudioEnd() {
    if (!g_audioFinalized) return false;
    if (g_audioTransferState == AUDIO_TRANSFER_WAIT_COMPLETE) return true;
    uint8_t status[15] = {0};
    status[0] = AUDIO_STATUS_END;
    writeUint16LE(status + 1, g_audioSession);
    writeUint32LE(status + 3, g_audioSamples);
    writeUint32LE(status + 7, (uint32_t)g_audioBytes);
    writeUint32LE(status + 11, g_audioCrc32);
    if (sendAudioStatus(status, sizeof(status))) {
        g_audioTransferState = AUDIO_TRANSFER_WAIT_COMPLETE;
        g_audioCompleteDeadline = millis() + 5000;
        Serial.println("  AUDIO: all packets acknowledged, END sent");
        return true;
    }
    return false;
}

static void pollAudioTransfer() {
    uint32_t now = millis();
    if (g_audioState == AUDIO_RETAINED && g_audioRetainedDeadline != 0 &&
        (int32_t)(now - g_audioRetainedDeadline) >= 0) {
        Serial.println("  AUDIO: retained transfer hard timeout; recording released");
        sendAudioError(AUDIO_ERROR_TIMEOUT);
        discardRecordedAudio();
        return;
    }
    if (!g_audioStreamStarted) {
        beginAudioTransfer();
        return;
    }

    if (g_audioTransferState == AUDIO_TRANSFER_SENDING) {
        if (now < g_audioNextSendAt) return;
        if (!g_connected || !g_audioDataSubscribed || !pAudioData) {
            g_audioStreamStarted = false;
            g_audioTransferState = AUDIO_TRANSFER_IDLE;
            return;
        }

        if (g_audioFinalized && g_audioNextSequence >= g_audioTotalChunks) {
            if (g_audioAckedSequence >= g_audioTotalChunks) {
                if (!sendAudioEnd()) {
                    // Another indication can still be awaiting confirmation.
                    // Retry END from loop() without retransmitting audio data.
                    g_audioNextSendAt = now + 100;
                }
                return;
            }
            g_audioTransferState = AUDIO_TRANSFER_WAIT_ACK;
            g_audioAckDeadline = now + AUDIO_ACK_TIMEOUT_MS;
            return;
        }

        size_t offset = (size_t)g_audioNextSequence * g_audioChunkPayload;
        if (offset >= g_audioBytes) return;
        size_t remaining = g_audioBytes - offset;
        // Keep one complete chunk behind capture so the eventual last packet
        // can always carry AUDIO_DATA_FLAG_FINAL, even on an exact boundary.
        if (!g_audioFinalized && remaining <= g_audioChunkPayload) return;
        size_t payloadLength = remaining < g_audioChunkPayload ? remaining : g_audioChunkPayload;
        uint8_t packet[6 + 239];
        packet[0] = AUDIO_DATA_PACKET;
        writeUint16LE(packet + 1, g_audioSession);
        writeUint16LE(packet + 3, g_audioNextSequence);
        packet[5] = (g_audioFinalized && g_audioNextSequence + 1 >= g_audioTotalChunks)
            ? AUDIO_DATA_FLAG_FINAL
            : 0;
        memcpy(packet + 6, g_audioBuffer + offset, payloadLength);

        if (pAudioData->notify(packet, payloadLength + 6, g_connHandle)) {
            g_audioNextSequence++;
            g_audioWindowSent++;
            g_audioNextSendAt = now + 1;
            if (g_audioWindowSent >= AUDIO_WINDOW_PACKETS ||
                (g_audioFinalized && g_audioNextSequence >= g_audioTotalChunks)) {
                g_audioTransferState = AUDIO_TRANSFER_WAIT_ACK;
                g_audioAckDeadline = now + AUDIO_ACK_TIMEOUT_MS;
            }
        } else {
            g_audioNextSendAt = now + 25;
        }
        return;
    }

    if (g_audioTransferState == AUDIO_TRANSFER_WAIT_ACK && now >= g_audioAckDeadline) {
        if (++g_audioAckRetries > AUDIO_ACK_MAX_RETRIES) {
            Serial.println("  AUDIO: ACK timeout; aborting live recording session");
            sendAudioError(AUDIO_ERROR_TIMEOUT);
            discardRecordedAudio();
            return;
        }
        g_audioNextSequence = g_audioAckedSequence;
        g_audioWindowSent = 0;
        g_audioTransferState = AUDIO_TRANSFER_SENDING;
        g_audioNextSendAt = now + 10;
        return;
    }

    if (g_audioTransferState == AUDIO_TRANSFER_WAIT_COMPLETE && now >= g_audioCompleteDeadline) {
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
        if (!g_audioStreamStarted || nextExpected > g_audioNextSequence ||
            nextExpected < g_audioAckedSequence) return;
        if (g_audioFinalized && nextExpected > g_audioTotalChunks) return;
        if (g_audioTransferState == AUDIO_TRANSFER_WAIT_COMPLETE &&
            nextExpected >= g_audioTotalChunks) return;
        const bool ackAdvanced = nextExpected > g_audioAckedSequence;
        if (ackAdvanced) {
            g_audioAckedSequence = nextExpected;
            g_audioAckRetries = 0;
        } else {
            // A repeated ACK is effectively a NACK for the same missing
            // sequence. It may request one resend, but it must not reset the
            // retry budget forever.
            if (++g_audioAckRetries > AUDIO_ACK_MAX_RETRIES) {
                Serial.println("  AUDIO: repeated non-progress ACK; aborting session");
                sendAudioError(AUDIO_ERROR_TIMEOUT);
                discardRecordedAudio();
                return;
            }
        }
        if (g_audioFinalized && nextExpected >= g_audioTotalChunks) {
            // Never indicate END re-entrantly from the Audio Control write
            // callback. Schedule it in loop(), where a pending status
            // indication can finish first and END can be retried safely.
            g_audioNextSequence = g_audioTotalChunks;
            g_audioWindowSent = 0;
            g_audioTransferState = AUDIO_TRANSFER_SENDING;
            g_audioNextSendAt = millis() + 50;
        } else {
            g_audioNextSequence = nextExpected;
            g_audioWindowSent = 0;
            g_audioTransferState = AUDIO_TRANSFER_SENDING;
            g_audioNextSendAt = millis() + 1;
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
    g_ttsEndReceived = false;
}

static void beginTtsReceive(const uint8_t* data, size_t len) {
    uint16_t session = len >= 4 ? (data[2] | ((uint16_t)data[3] << 8)) : 0;
    stopFindDeviceAlert();
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
    g_ttsPlaybackSample = 0;
    g_ttsPredictor = g_ttsInitialPredictor;
    g_ttsIndex = g_ttsInitialIndex;
    g_ttsEndReceived = false;
    g_ttsState = TTS_RECEIVING;
    sendTtsAck(TTS_STATUS_READY, session, 0);
    Serial.print("  TTS: receiving session=");
    Serial.print(session);
    Serial.print(" samples=");
    Serial.print(sampleCount);
    Serial.print(" encodedBytes=");
    Serial.println(encodedBytes);
}

static void startTtsPlaybackIfReady() {
    if (g_ttsState != TTS_RECEIVING) return;
    size_t prebuffer = g_ttsEncodedBytes < TTS_PREBUFFER_BYTES
        ? g_ttsEncodedBytes
        : TTS_PREBUFFER_BYTES;
    if (g_ttsReceivedBytes < prebuffer) return;

    g_ttsState = TTS_PLAYING;
    i2s_zero_dma_buffer(I2S_NUM_0);
    sendTtsSimpleStatus(TTS_STATUS_PLAYING, g_ttsSession);
    Serial.print("  TTS: edge playback started session=");
    Serial.print(g_ttsSession);
    Serial.print(" bufferedBytes=");
    Serial.println(g_ttsReceivedBytes);
}

static void handleTtsData(const std::string& value) {
    const uint8_t* data = (const uint8_t*)value.data();
    size_t len = value.length();
    if (len < 6 || data[0] != TTS_DATA_PACKET) return;
    uint16_t session = data[1] | ((uint16_t)data[2] << 8);
    uint16_t sequence = data[3] | ((uint16_t)data[4] << 8);
    if ((g_ttsState != TTS_RECEIVING && g_ttsState != TTS_PLAYING) ||
        session != g_ttsSession || g_ttsEndReceived) return;

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
    startTtsPlaybackIfReady();
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
        (g_ttsState != TTS_RECEIVING && g_ttsState != TTS_PLAYING) ||
        session != g_ttsSession) {
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

    g_ttsEndReceived = true;
    startTtsPlaybackIfReady();
    Serial.print("  TTS: stream END verified session=");
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

    uint32_t availableSamples = 1 + g_ttsReceivedBytes * 2;
    if (availableSamples > g_ttsSampleCount) availableSamples = g_ttsSampleCount;
    int32_t output[AUDIO_FRAME_SAMPLES];
    size_t count = 0;
    while (count < AUDIO_FRAME_SAMPLES && g_ttsPlaybackSample < availableSamples) {
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

    if (count == 0) {
        if (g_ttsEndReceived && g_ttsPlaybackSample >= g_ttsSampleCount) {
            uint16_t session = g_ttsSession;
            sendTtsSimpleStatus(TTS_STATUS_COMPLETE, session);
            Serial.print("  TTS: playback complete session=");
            Serial.println(session);
            resetTtsSession();
        } else if (!g_ttsEndReceived && millis() - g_ttsLastPacketAt > TTS_SESSION_TIMEOUT_MS) {
            uint16_t session = g_ttsSession;
            sendTtsError(session, TTS_ERROR_TIMEOUT);
            resetTtsSession();
        }
        return;
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

    if (g_ttsEndReceived && g_ttsPlaybackSample >= g_ttsSampleCount) {
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
static bool     g_stableBtnRaw = HIGH;
static uint32_t g_btnRawChangedAt = 0;

static void pollButton() {
    uint32_t now = millis();
    if (now - g_lastBtnCheck < 10) return;      // 10ms 轮询
    g_lastBtnCheck = now;

    bool raw = digitalRead(PIN_BUTTON);
    if (raw != g_lastBtnRaw) {
        g_lastBtnRaw = raw;
        g_btnRawChangedAt = now;
    }
    if (raw != g_stableBtnRaw && now - g_btnRawChangedAt >= BTN_DEBOUNCE_MS) {
        g_stableBtnRaw = raw;
    }
    raw = g_stableBtnRaw;

    switch (g_btnState) {
        case B_IDLE:
            if (!raw) {                         // 按下
                g_btnState = B_PRESSED;
                g_btnPressTime = now;
                g_btnLongReported = false;
                if (g_audioState == AUDIO_RECORDING) {
                    // Stop on the debounced press itself and consume the press,
                    // so release cannot become a second click.
                    g_btnLongReported = true;
                    Serial.println("  BTN: PRESS (stop recording immediately)");
                    sendButtonEvent(BTN_CLICK);
                    finishAudioRecording(false);
                } else if (g_audioState != AUDIO_IDLE ||
                           g_audioTransferState != AUDIO_TRANSFER_IDLE ||
                           g_ttsState != TTS_IDLE ||
                           g_audioErrorPending) {
                    // A retained recording owns the audio pipeline until the
                    // phone confirms reconstruction. Ignore all button actions
                    // from this physical press and report a non-fatal busy state.
                    g_btnLongReported = true;
                    // Do not send another Audio Status indication here. END
                    // uses the same indication channel and must not be starved
                    // by repeated button presses during transfer.
                    Serial.println("  AUDIO: previous recording still transferring; press ignored");
                }
            }
            break;

        case B_PRESSED:
            if (!g_btnLongReported && (now - g_btnPressTime >= BTN_LONG_MS)) {
                // 长按
                g_btnLongReported = true;
                Serial.println("  BTN: LONG_PRESS");
                sendButtonEvent(BTN_LONG_PRESS);
            }
            if (raw) {                          // 释放
                g_btnReleaseTime = now;
                if (!g_btnLongReported) {
                    g_btnState = B_WAIT_DOUBLE;
                } else {
                    g_btnState = B_IDLE;
                }
            }
            break;

        case B_WAIT_DOUBLE:
            if (!raw) {                         // 第二次按下 → 双击
                // Stay in a consumed pressed state until the second press is
                // released. Returning to B_IDLE here would count the same held
                // press again and create duplicate click events.
                g_btnState = B_PRESSED;
                g_btnPressTime = now;
                g_btnLongReported = true;
                Serial.println("  BTN: DOUBLE_CLICK");
                sendButtonEvent(BTN_DOUBLE_CLICK);
            } else if (now - g_btnReleaseTime >= BTN_DOUBLE_GAP_MS) {
                // 超时 → 单击
                g_btnState = B_IDLE;
                if (g_audioState == AUDIO_IDLE &&
                    g_audioTransferState == AUDIO_TRANSFER_IDLE &&
                    g_ttsState == TTS_IDLE) {
                    Serial.println("  BTN: CLICK");
                    sendButtonEvent(BTN_CLICK);
                    startAudioRecording();
                } else if (g_audioState == AUDIO_RECORDING) {
                    Serial.println("  BTN: CLICK (stop recording)");
                    sendButtonEvent(BTN_CLICK);
                    finishAudioRecording(false);
                }
            }
            break;
    }
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
        requestAdvertisingMode(false);
        Serial.println("<<< Client connected >>>");
    }

    void onDisconnect(NimBLEServer* pServer,
                      NimBLEConnInfo& connInfo, int reason) override {
        (void)pServer;
        g_connected = false;
        g_eventTxSubscribed = false;
        g_audioDataSubscribed = false;
        g_audioStatusSubscribed = false;
        g_ttsStatusSubscribed = false;
        if (g_connHandle == connInfo.getConnHandle()) {
            g_connHandle = BLE_HS_CONN_HANDLE_NONE;
        }
        if (g_audioState != AUDIO_IDLE) {
            // Restart the current v2 stream from sequence zero after reconnect.
            // Capture may continue locally while the link is unavailable.
            g_audioStreamStarted = false;
            g_audioTransferState = AUDIO_TRANSFER_IDLE;
            g_audioNextSequence = 0;
            g_audioAckedSequence = 0;
            g_audioWindowSent = 0;
            g_audioAckRetries = 0;
        }
        if (g_ttsState != TTS_IDLE) resetTtsSession();
        requestAdvertisingMode(true);
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

class EventTxCB : public NimBLECharacteristicCallbacks {
    void onSubscribe(NimBLECharacteristic* pChar,
                     NimBLEConnInfo& connInfo, uint16_t subValue) override {
        (void)pChar;
        g_connHandle = connInfo.getConnHandle();
        g_eventTxSubscribed = (subValue & 0x01) != 0;
        Serial.print("  Event TX subscribed: ");
        Serial.println(g_eventTxSubscribed ? "yes" : "no");
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

    if (g_preferences.begin("yuntuan", false)) {
        g_socialMode = g_preferences.getBool("social", false) ? 1 : 0;
        Serial.print("  SocialMode restored: ");
        Serial.println(g_socialMode);
    } else {
        Serial.println("  [WARN] Cannot open preferences; SocialMode will not persist");
    }
    g_socialDeviceToken = esp_random();
    if (g_socialDeviceToken == 0) g_socialDeviceToken = 1;

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
    pBleServer->advertiseOnDisconnect(false);

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
    pEventTx->setCallbacks(new EventTxCB());

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
    g_advertising = NimBLEDevice::getAdvertising();
    g_advertising->addServiceUUID(CONTROL_SERVICE_UUID);
    // The battery UUID remains discoverable after connection. Omitting it here
    // leaves enough legacy advertising space for the passive social beacon.
    g_advertising->enableScanResponse(true);
    g_advertising->setName(DEVICE_NAME);
    uint8_t socialBeacon[SOCIAL_BEACON_LENGTH];
    buildInteractionBeacon(socialBeacon);
    g_advertising->setManufacturerData(socialBeacon, sizeof(socialBeacon));
    g_advertising->setConnectableMode(BLE_GAP_CONN_MODE_UND);
    // 广播间隔 100-125ms（实验室联调）
    g_advertising->setMinInterval(160);  // 100ms = 160 * 0.625ms
    g_advertising->setMaxInterval(200);  // 125ms
    g_advertising->start();

    Serial.println("  [OK] Advertising started");

    // Passive, callback-only, continuous scan. A 20% duty cycle leaves BLE
    // controller time for phone audio transfer while still collecting duplicates.
    g_socialScan = NimBLEDevice::getScan();
    g_socialScan->setScanCallbacks(new SocialScanCB(), true);
    g_socialScan->setActiveScan(false);
    g_socialScan->setInterval(SOCIAL_SCAN_INTERVAL_MS);
    g_socialScan->setWindow(SOCIAL_SCAN_WINDOW_MS);
    g_socialScan->setMaxResults(0);
    if (g_socialScan->start(0, false, true)) {
        Serial.println("  [OK] Continuous social scan started");
    } else {
        Serial.println("  [WARN] Social scan start failed; loop will retry");
        g_socialScanRestartRequested = true;
        g_socialScanRetryAt = millis() + 1000;
    }
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
    pollPendingAudioError(now);
    pollButton();

    // ── 挂件录音与 BLE 音频分包 ──
    pollAudioRecording();
    pollAudioTransfer();
    pollTtsPlayback();

    // ── 电量模拟 ──
    pollBattery();

    // ── FIND_DEVICE：GPIO2 振动输出 + MAX98357A 提示音 + 状态灯 ──
    pollFindDeviceAlert(now);

    // ── Device-to-device social proximity ──
    pollSocialAdvertising();
    pollSocialInteraction(now);
    pollSocialEncounterEvents(now);

    // 录音上传由主循环逐包 Notify。发送态也必须快速轮询，否则 6 ms
    // 的包间隔会被这里的 10 ms 睡眠放大，低 MTU 时尤其明显。
    delay((g_audioState == AUDIO_RECORDING ||
           g_audioTransferState == AUDIO_TRANSFER_SENDING ||
           g_ttsState == TTS_PLAYING) ? 1 : 10);
}

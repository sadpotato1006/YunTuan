# 云团微信小程序

“云团”是面向随迁老人的陪伴类产品。本仓库当前提供原生微信小程序前端、可部署的聊天云函数、Mock 数据，以及云团 BLE 控制、录音上行和语音播放实现。真实 AI、ASR 和 TTS 仍需云端环境变量，真实 BLE 功能需要与符合协议的挂件固件进行真机联调。

硬件联调请以 [云团智能挂件软硬件 BLE 通信协议 v0.2 评审稿](docs/YUNTUAN_BLE_PROTOCOL_REVIEW_V0.2.md) 为准。原 [v0.1 综合草案](docs/YUNTUAN_BLE_PROTOCOL_V0.1.md) 保留量产认证设计，尚未冻结。

## 后端模式

在 `miniprogram/config/index.js` 中修改 `backendMode`：

- `mock`：本地 Promise 模拟数据，无需网络、服务器或云开发环境，当前默认模式，适合界面和交互开发。
- `cloud`：由 `wx.cloud.callFunction` 调用微信云函数，适合承载 AI 调用、云数据库和设备绑定数据。
- `http`：由统一封装的 `wx.request` 调用自建服务器，未来可连接 Node.js、Python 或 Java 后端。
- `ble`：仅供设备业务使用，由手机直接连接附近的云团 BLE 挂件。

页面只调用 `services`，切换模式不需要修改页面。

也可以通过 `serviceBackendModes` 为不同业务单独指定模式。当前项目的聊天和心情记录调用云函数，设备使用本机 BLE：

```js
serviceBackendModes: {
  chat: "cloud",
  device: "ble",
  emotion: "cloud"
}
```

某项未配置时，会自动使用 `backendMode` 作为默认值。

## 使用 Mock 模式

保持以下配置即可直接编译运行：

```js
backendMode: "mock",
cloudEnvId: ""
```

Mock 模式不会初始化或调用 `wx.cloud`，因此无需创建云环境。设备页的“设备详细信息”入口集中提供设备版本、连接管理、模拟挂件和 BLE 联调，可以在没有真实硬件时验证 BLE 1.7 控制协议。模拟挂件只声明其实际提供的控制、相遇和提醒能力，不伪装音频服务。

## 使用微信云开发

1. 在微信开发者工具中打开“云开发”，按提示创建环境。
2. 在云开发控制台或开发者工具中复制环境 ID。
3. 将环境 ID 填入 `miniprogram/config/index.js` 的 `cloudEnvId`，并把 `backendMode` 改为 `cloud`。
4. 在开发者工具的 `cloudfunctions` 目录中，依次右键 `chat`、`device`、`emotion`、`social`。
5. 选择“上传并部署：云端安装依赖”。
6. 重新编译小程序。

`project.config.json` 已配置 `cloudfunctionRoot: "cloudfunctions/"`。

## 接入真实 AI

小程序前端只应调用 `chat` 云函数，不应直接调用 AI 平台。请在 `cloudfunctions/chat/index.js` 中接入 AI SDK 或 HTTP API，并将 API Key 配置为云函数环境变量或其他安全配置。

**任何 AI API Key 都不能写在小程序代码、配置文件或提交到源码仓库中。** 云函数收到小程序消息后调用 AI，再按 `{ code, message, data }` 格式返回结果。

`chat` 云函数同时提供腾讯云实时 ASR、一句话识别降级与 TTS。实时 ASR 除 `ASR_SECRET_ID`、`ASR_SECRET_KEY` 外还必须配置 `ASR_APP_ID`，并在微信公众平台把 `wss://asr.cloud.tencent.com` 加入 socket 合法域名。TTS 可设置 `TTS_SECRET_ID`、`TTS_SECRET_KEY`、`TTS_SESSION_TOKEN`、`TTS_REGION`、`TTS_VOICE_TYPE`、`TTS_SPEED` 和 `TTS_VOLUME`；未单独设置 TTS 密钥时会复用对应的 `ASR_*` 密钥。部署时必须选择“上传并部署：云端安装依赖”。

### 连续对话与上线保护

小程序会把最近最多 12 条、合计不超过 4000 个字符的对话作为上下文发送给 `chat` 云函数。云函数不会接受 `system` 角色，并会再次校验角色、单条长度、上下文总长度和当前消息长度。完整页面记录仍只保存在本机；`chat_usage` 不保存用户消息和对话上下文，但会保留最近 20 个请求的 AI 回复，用于断网重试时直接返回结果并避免重复计费。

部署新版 `chat` 云函数前，需要在云开发数据库中创建 `chat_usage` 集合，并把集合权限设置为仅云函数可读写。该集合使用不可逆哈希文档 ID：聊天幂等状态使用 `OPENID` 哈希，ASR 与 TTS 用量使用 `OPENID + action` 的独立哈希，避免流式回复结束和分段语音合成争用同一文档。文档记录分钟窗口、当日调用次数，聊天文档还保留最近 20 个请求的幂等状态；每日额度按北京时间零点重置。小程序会为同一条消息生成稳定的 `requestId`，流式请求、普通模式降级和用户重试会复用它，因此已经完成的回复可直接从幂等缓存返回，不会再次调用 AI 或重复扣减额度。

当前开发版本按项目决定默认关闭微信内容安全检查，因此不会再因无效微信 access token 返回“内容安全检查暂时不可用”。如后续需要恢复，可把两个聊天函数的 `CHAT_CONTENT_SECURITY_ENABLED` 都设为 `true`，并保证 `security.msgSecCheck` 权限和微信调用凭据可用。

### 半流式语音回复

`chat-stream` 是独立的 HTTP 云函数。它向上游 AI 发送 `stream: true`，首个自然句段约 16 个字符，后续句段约 40 个字符；每个句段立即用 SSE 推给小程序。小程序收到首段后，不等待 AI 完整回复，直接启动 TTS；后续 TTS 云调用保持单并发并可与当前语音的 BLE 播放重叠，既保留流水线低延迟，也避免多个用量事务互相冲突。保护事务出现瞬时 503 时会短退避重试，单个句段最终失败也不会阻断后续已排队语音。挂件协议已升级为 v2：录音、BLE 上行和实时 ASR 重叠，TTS 预缓冲约 400ms 后边收边播。

部署时需要额外完成以下配置：

1. 在云开发环境中把 `cloudfunctions/chat-stream` 创建或部署为 **HTTP 云函数**，启动文件使用 `scf_bootstrap`，监听端口为 `9000`，函数超时建议设为至少 60 秒；普通“上传并部署”不会自动把它转换成 HTTP 云函数。
2. 为 `chat-stream` 安装 `package.json` 中的云端依赖，并把 `AI_API_URL`、`AI_API_KEY`、`AI_MODEL` 以及所有 `CHAT_*` 保护环境变量配置成与 `chat` 一致。
3. 保留 `config.json` 中的 `security.msgSecCheck` 权限，并继续使用同一个仅云函数可读写的 `chat_usage` 集合。
4. 小程序调试基础库使用 `3.15.2` 或更高版本，以支持 `wx.cloud.callHTTPFunction` 的分块接收。

也可使用 CloudBase CLI 从项目根目录部署：

```powershell
tcb fn deploy chat-stream --httpFn
```

`miniprogram/config/index.js` 中的 `streamChatEnabled` 默认开启。若上游 AI 明确拒绝流式参数，`chat-stream` 会在同一次受限额保护的请求中改用普通 AI 响应；若基础库过旧或 HTTP 函数未部署，小程序会自动退回原 `chat` 云函数。一旦已展示或播放部分回复，则不会再次请求完整回复，避免内容重复。

### 情绪记录云存储

情绪功能使用 `emotion` 云函数，并按不可逆哈希后的微信 `OPENID` 隔离数据。部署前需在云开发数据库中创建 `emotion_records` 集合，将权限设为仅云函数可读写，然后重新部署 `emotion` 云函数。新用户默认没有记录；同一用户每天只保留一条，再次选择会更新当天记录。用户可填写最多 100 个字符的可选备注；点击输入框时会自动清空所选心情的默认语句，最终留空则仍保存并展示默认语句。页面最多返回最近 30 条。

### 社交名片与相遇展示

社交名片和伙伴文字聊天使用 `social` 云函数。部署前需要在云开发数据库中创建以下十三个集合，并把权限类型全部选择“所有用户不可读写”（云函数使用服务端权限访问）：

- `social_profiles`：按微信用户 OpenID 的不可逆哈希保存公开名片；
- `social_tokens`：把挂件本次启动生成的随机匿名 Token 临时映射到名片，为支持离线相遇补发默认保留 7 天；
- `social_resolve_usage`：限制单个用户查询附近名片的频率。
- `social_encounter_refs`：保存最长 7 天的匿名相遇互动凭证；
- `social_greetings`：保存定向招呼及对方的接受或拒绝状态；
- `social_matches`：双方明确同意后，为两边分别保存已认识关系、未读数和最后一条消息摘要；
- `social_conversations`：保存双方确认后自动建立的一对一会话；
- `social_messages`：保存双方在伙伴页主动发送的文字和表情消息；
- `social_contact_requests`：保存联系方式交换的申请和双向确认状态；
- `social_contacts`：只在双方同意后保存各自主动分享的联系方式；
- `social_contact_files`：登记联系方式二维码文件归属，防止冒用他人文件触发删除；
- `social_blocks`：保存当前用户主动屏蔽的关系；
- `social_reports`：保存被举报消息的内容快照、原因和处理状态。

数据量增长前建议在控制台的“索引管理”中按下表创建索引。字段方向严格按表中标注选择；未单独标注的单字段索引选“升序”。索引属性均选“非唯一”，系统自动创建的 `_id_` 和 `_openid_1` 保持不动。

| 集合 | 索引名称 | 类型 | 索引字段（按顺序） |
| --- | --- | --- | --- |
| `social_greetings` | `idx_greetings_recipient_status_sort` | 组合索引 | `recipientOwnerKey`（升序）、`status`（升序）、`inboxSortKey`（降序） |
| `social_greetings` | `idx_greetings_sender` | 单字段索引 | `senderOwnerKey` |
| `social_matches` | `idx_matches_owner` | 单字段索引 | `ownerKey` |
| `social_matches` | `idx_matches_owner_sort` | 组合索引 | `ownerKey`（升序）、`inboxSortKey`（降序） |
| `social_matches` | `idx_matches_peer` | 单字段索引 | `peerOwnerKey` |
| `social_tokens` | `idx_tokens_owner` | 单字段索引 | `ownerKey` |
| `social_encounter_refs` | `idx_refs_requester` | 单字段索引 | `requesterOwnerKey` |
| `social_encounter_refs` | `idx_refs_target` | 单字段索引 | `targetOwnerKey` |
| `social_conversations` | `idx_conversations_member_a` | 单字段索引 | `memberAOwnerKey` |
| `social_conversations` | `idx_conversations_member_b` | 单字段索引 | `memberBOwnerKey` |
| `social_messages` | `idx_messages_conversation_created` | 组合索引 | `conversationId`（升序）、`createdAt`（降序） |
| `social_messages` | `idx_messages_sender` | 单字段索引 | `senderOwnerKey` |
| `social_messages` | `idx_messages_recipient` | 单字段索引 | `recipientOwnerKey` |
| `social_contact_requests` | `idx_contact_requests_requester` | 单字段索引 | `requesterOwnerKey` |
| `social_contact_requests` | `idx_contact_requests_recipient` | 单字段索引 | `recipientOwnerKey` |
| `social_contacts` | `idx_contacts_owner` | 单字段索引 | `ownerKey` |
| `social_contacts` | `idx_contacts_peer` | 单字段索引 | `peerOwnerKey` |
| `social_contact_files` | `idx_contact_files_owner` | 单字段索引 | `ownerKey` |
| `social_blocks` | `idx_blocks_blocker` | 单字段索引 | `blockerOwnerKey` |
| `social_blocks` | `idx_blocks_blocked` | 单字段索引 | `blockedOwnerKey` |
| `social_reports` | `idx_reports_reporter` | 单字段索引 | `reporterOwnerKey` |
| `social_reports` | `idx_reports_reported` | 单字段索引 | `reportedOwnerKey` |
| `social_reports` | `idx_reports_status` | 单字段索引 | `status` |

伙伴页的朋友和待处理招呼分别按 `inboxSortKey` 倒序分页，每页默认 20 条；旧记录首次读取时会自动补齐排序字段。前台刷新采用自适应间隔：聊天页从 5 秒逐步放慢到 30 秒，伙伴页从 15 秒逐步放慢到 60 秒；检测到新消息或用户主动发送后恢复最快间隔，小程序进入后台后停止刷新。

联系方式分享使用稳定请求编号保证幂等：同一次请求因网络超时重试时不会重复写入或重复提醒。新上传的二维码先在 `social_contact_files` 中登记为临时文件，正式分享后转为已分享状态；未完成分享的临时文件在 24 小时后过期，并在下次进入联系方式页面或再次准备分享时自动清理。

保存名片时，小程序先把自定义头像上传到云存储的 `social-avatars/` 目录，再由 `social` 云函数保存头像、昵称、一句话介绍、最多三个兴趣标签和社交意愿。名片设置还可以在当前设备保存最多 8 条私密分享资料，包括多个微信号、手机号或二维码；这些预设不会写入 `social_profiles`，也不会随公开名片上传。换设备或清除本机缓存后需要重新填写。旧开发版本曾上传的预设会在用户下次打开社交名片页时先迁移到本机，再从名片云端记录中移除。真实姓名、联系方式、位置、聊天记录、设备 ID、设备序列号和 OpenID 都不会作为公开名片返回。

挂件连接后，小程序读取本次启动的匿名 Token 并登记到云端，之后会在恢复设备页和到期前自动续期。两台都开启社交模式的挂件靠近并满足 RSSI 规则后，双方挂件按个人提醒设置反馈，并向已连接的小程序发送对方 Token；小程序再用 Token 查询对方的公开名片并写入最近 30 次相遇记录。用户可以通过匿名互动凭证打招呼；收到的招呼直接显示在“伙伴”页朋友列表下方，不再进入独立页面，两个列表可以分别折叠，朋友始终优先显示。对方明确点击“认识 TA”后，云端才会建立双方专属的一对一会话。伙伴聊天当前只支持用户主动确认发送的文字、表情和快捷开场，不包含录音、语音消息、语音转文字或音视频通话。客户端不会获得对方 OpenID、设备 ID、精确位置或真实身份。

伙伴消息只能由会话双方通过 `social` 云函数读取，数据库集合禁止小程序直接读写；发送请求带稳定请求编号，网络重试不会重复创建消息或累计未读。聊天记录按 `createdAt` 倒序查询，每页 30 条，客户端按游标加载更早消息。打招呼的发起方在对方首次回复前最多发送 3 条消息，限制由云端会话事务强制执行；对方回复后自动解除。服务端同时限制每个微信用户每分钟最多发送 12 条、每天最多 200 条伙伴消息，并拒绝网址、外部链接以及绕过交换流程直接粘贴的手机号或微信号。伙伴动态只在小程序打开后通过列表、红点和前台刷新展示，不申请微信订阅消息，也不会在小程序关闭后发送服务通知。

联系方式采用两次主动操作：一方申请、另一方明确同意后，双方才分别从本机预设中勾选一条或多条分享；同意申请不会自动公开任何内容。只有点击“分享所选资料”后，本次选择的快照才写入 `social_contacts`，所选二维码才上传到 `social-contact-qrs/`。聊天页只显示紧凑状态入口，查看、勾选和撤回在独立联系方式页完成，不占据聊天记录区域。之后修改本机预设不会悄悄改变已经分享的内容。分享者可以撤回当前会话中的云端展示；已经被对方复制、保存或截图的内容无法追回。解除伙伴或屏蔽会立即结束云端关系并禁止继续发消息，同时撤回双方云端联系方式；屏蔽还会阻止双方通过附近挂件再次解析名片。聊天页支持只清空自己这一侧的历史显示，长按对方消息可以举报并保存必要的消息快照供后续处理。

设置页提供“删除全部个人云端数据”，会删除情绪记录、社交名片与头像、联系方式二维码、招呼、伙伴关系、伙伴会话和消息、屏蔽与举报记录，以及 AI 聊天幂等/用量记录，并在成功后清除本机缓存。该操作可重复调用，以便网络中断后再次完成删除。情绪仅以名称、图标和用户备注呈现，不再生成或保存固定分数。

部署或更新后请重新上传 `social` 云函数并选择“云端安装依赖”。测试命令：

```powershell
node tests\social_cloudfunction_test.js
node tests\social_text_chat_test.js
node tests\social_encounter_reliability_test.js
node tests\social_profile_test.js
node tests\social_proximity_test.js
node tests\settings_alert_test.js
node tests\ble_simulator_test.js
```

### 没有硬件时调试社交功能

只有一个开发者和一个微信账号时：

1. 先保存自己的社交名片，再从设备页进入“设备详细信息”，点击“加载模拟挂件”。
2. 返回设备页开启社交模式，再进入“设备详细信息”点击“创建测试伙伴并模拟相遇”。云函数会为当前账号创建一位隔离的“云团测试伙伴”，并通过模拟挂件注入标准相遇事件。
3. 返回设备页，在“最近相遇”卡片直接点击“打个招呼”；测试伙伴会自动接受，随后在“伙伴”页进入会话。
4. 会话顶部会明确显示“单人测试模式”。点击“模拟对方操作”，可以让测试伙伴发消息、申请或同意交换联系方式，以及分享虚假的测试微信号。

测试伙伴不对应真实微信用户，只能被创建它的当前账号控制。“删除全部个人云端数据”也会一并清理该测试伙伴的数据。相遇解析、名片查询、招呼、匹配、会话、消息和联系方式仍使用正式云函数及数据库权限链路。

需要验证两位真实微信用户之间的收件箱、未读提醒和双端状态同步时，可以继续使用双账号模式：

伙伴聊天和联系方式交换使用微信云开发，硬件只负责产生“相遇”事件。开发阶段可以用两个不同微信账号和两台模拟挂件完成整条链路：

1. 将小程序编译为体验版，让账号 A、B 分别进入；两个窗口使用同一个微信账号时云函数仍会视为同一用户。
2. A、B 各自保存社交名片，然后从设备页进入“设备详细信息”，点击“加载模拟挂件”。
3. 每个小程序实例会生成并持久化一个独立的 32 位模拟 Token；点击“重新登记 Token”确保它已经绑定到当前云端名片。
4. B 复制自己的模拟 Token 发给 A；A 点击“输入对方 Token”并粘贴 B 的 Token。模拟器会以 `-55 dBm` 注入标准 `SOCIAL_ENCOUNTER` 事件。
5. 事件仍经过正式的协议解析、相遇记录落盘、公开名片查询、提醒设置和 `ACK_SOCIAL_ENCOUNTER` 链路。A 等名片加载完成后，进入“全部相遇记录”查看 B 并打招呼。
6. B 在“伙伴”页接受后，即可继续测试文字聊天、未读、联系方式双向确认、撤回、举报、解除关系和屏蔽。若需要验证双方都收到相遇提醒，再在 B 端输入 A 的 Token 注入一次。

模拟器还支持电量、设备信息、社交模式、查找挂件、Ping 和提醒设置。RSSI 距离准确性、真实扫描广播、振动/声音效果、物理按键、BLE 丢包/重连、录音播放和功耗仍必须等真实硬件到手后验证。

可以通过以下云函数环境变量调整保护阈值：

| 环境变量 | 默认值 | 说明 |
| --- | ---: | --- |
| `CHAT_RATE_WINDOW_SECONDS` | `60` | 用户级频率窗口，允许 10～3600 秒 |
| `CHAT_RATE_MAX_REQUESTS` | `12` | 单个窗口内聊天、ASR、TTS 的合计请求上限 |
| `CHAT_DAILY_CHAT_QUOTA` | `100` | 每人每天文字聊天上限 |
| `CHAT_DAILY_ASR_QUOTA` | `60` | 每人每天语音识别上限 |
| `CHAT_DAILY_TTS_QUOTA` | `100` | 每人每天语音合成上限 |
| `CHAT_CONTENT_SECURITY_ENABLED` | `false` | 当前开发版本关闭；设为 `true` 才启用微信内容安全检查 |

聊天保护逻辑测试：

```powershell
node tests\chat_guard_test.js
node tests\chat_stream_test.js
```

## 使用自建服务器

购买并部署服务器后：

1. 把 `backendMode` 改为 `http`。
2. 把 `baseUrl` 改为真实 HTTPS API 地址。
3. 在微信公众平台配置服务器域名白名单。
4. 让后端接口与现有 services 中的路径和统一返回结构保持一致。

HTTP 请求由 `miniprogram/utils/request.js` 统一处理成功响应、非 2xx 状态码、业务错误、网络失败和超时。

## BLE 说明

BLE 搜索、连接、断开和数据通信使用小程序端的微信蓝牙 API。当前已实现：

- `HELLO`、`GET_STATUS`、`SET_SOCIAL_MODE`、`SET_ALERT_SETTINGS`、`FIND_DEVICE`、`PING`；
- Event TX 和标准 Battery Level 订阅；
- CRC-16/CCITT-FALSE 校验；
- Sequence 响应匹配、命令超时和有限重试；
- 1、3、5、10、15、30 秒退避重连，并保存最近一次成功连接的真实设备；
- 硬件 PTT 录音边采集边以 IMA-ADPCM 上传，并增量解码后调用实时 ASR；
- 腾讯云 TTS 合成、IMA-ADPCM 下发、CRC32 校验和 MAX98357A 播放；
- 协议化模拟挂件。

### 语音首响延迟优化

挂件语音链路针对“按下 PTT 到第一次播放”做了以下优化：

- 有效语音后的自动收音等待由 1.2 秒缩短为 0.8 秒；
- 固件录音和 BLE ACK 使用独立状态机，录音产生数据后立即上传，I2S 读取改为非阻塞轮询；
- 挂件 WAV 在内存中直接转为 Base64 上传 ASR，不再先写临时文件再读回；
- ADPCM 在小程序中增量解码，每约 200ms PCM 上传腾讯云实时 ASR；实时连接失败时才回退完整 WAV；
- AI 回复最多取 150 个字符朗读，首段约 16 字符，后续按约 40 个字符自然分段；
- 流式 AI 的首个安全句段到达后立即生成并下发语音，后续句段在第一段播放期间并行预取；
- 流式服务不可用时，第一段语音仍会单独生成，后续段批量并行生成；
- TTS 协议 v2 在约 400ms 预缓冲后开始 I2S 播放，同时继续接收剩余 BLE 分包；
- 协议直接升级到控制版本 `1.7`、Audio/TTS Version `2`，不兼容旧开发固件；提醒设置持久化在挂件，相遇事件使用 NVS 队列、本地落盘去重和应用层 ACK。

真机调试时，小程序控制台会输出 `[VOICE_LATENCY]`，其中包含录音、BLE 上行、ASR、AI、首段 TTS、BLE 下行和“按键到首次播放”的分段耗时。部署后应以该日志确认当前网络或硬件环境中的实际瓶颈。

录音上行见 [云团 BLE 实时录音上传协议 v2](docs/YUNTUAN_BLE_AUDIO_TRANSFER_V0.3.md)，播放下行见 [云团 BLE 边收边播协议 v2](docs/YUNTUAN_BLE_SPEECH_PLAYBACK_V0.4.md)。量产认证和 OTA 仍未实现。

协议测试：

```powershell
node tests\audio_stream_test.js
node tests\realtime_asr_test.js
node tests\tts_edge_playback_test.js
node tests\chat_stream_test.js
node tests\chat_guard_test.js
node tests\chat_cloudfunction_test.js
```

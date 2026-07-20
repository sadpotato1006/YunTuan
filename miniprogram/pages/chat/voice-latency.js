function buildVoiceLatencyMetrics(trace, now) {
  const source = trace && typeof trace === "object" ? trace : {};
  const firstPlaybackAt = source.firstPlaybackAt || Number(now) || Date.now();
  return {
    recordingMs: source.recordingMs || 0,
    bleUploadMs: source.bleUploadMs || 0,
    bleMtu: source.bleMtu || 0,
    bleChunkPayload: source.bleChunkPayload || 0,
    blePacketCount: source.blePacketCount || 0,
    bleEncodedBytes: source.bleEncodedBytes || 0,
    asrMode: source.asrMode || "unknown",
    asrMs: source.asrMs || 0,
    aiAndNetworkMs: source.aiAndNetworkMs || 0,
    firstSpeechSynthesisMs: source.firstSpeechSynthesisMs || 0,
    bleDownlinkToPlaybackMs: source.firstSpeechReadyAt ? firstPlaybackAt - source.firstSpeechReadyAt : 0,
    pressToFirstPlaybackMs: source.recordingStartedAt ? firstPlaybackAt - source.recordingStartedAt : 0
  };
}

module.exports = { buildVoiceLatencyMetrics };

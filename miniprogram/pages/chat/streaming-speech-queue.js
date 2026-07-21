function createStreamingSpeechQueue(page, chatService, deviceTtsService, voiceTrace) {
  const maximumCharacters = 150;
  const maximumSegments = 4;
  let queuedCharacters = 0;
  let segmentNumber = 0;
  let synthesisChain = Promise.resolve();
  let playbackChain = Promise.resolve();
  let firstError = null;
  let firstSpeechReady = false;

  return {
    enqueue(text) {
      const available = maximumCharacters - queuedCharacters;
      if (available <= 0 || segmentNumber >= maximumSegments) return;
      const speechText = Array.from(typeof text === "string" ? text : "")
        .slice(0, available)
        .join("")
        .trim();
      if (!speechText) return;

      queuedCharacters += Array.from(speechText).length;
      segmentNumber += 1;
      const currentSegment = segmentNumber;
      const synthesisStartedAt = Date.now();
      // TTS 云调用保持单并发，仍可与上一段 BLE 播放并行，避免同一用户用量事务互相冲突。
      const prepared = synthesisChain.then(() => {
        if (page._pageActive === false) return { skipped: true };
        return chatService.synthesizeSpeech(speechText);
      }).then(
        result => ({ result }),
        error => ({ error })
      );
      synthesisChain = prepared.then(() => undefined);

      playbackChain = playbackChain.then(async () => {
        const synthesized = await prepared;
        if (synthesized.result && synthesized.result.skipped) return;
        if (synthesized.error) {
          if (!firstError) firstError = synthesized.error;
          console.warn(`第 ${currentSegment} 段语音合成失败，继续处理后续语音：`, synthesized.error.message);
          return;
        }
        if (page._pageActive === false) return;
        if (!firstSpeechReady && voiceTrace) {
          firstSpeechReady = true;
          voiceTrace.firstSpeechReadyAt = Date.now();
          voiceTrace.firstSpeechSynthesisMs = voiceTrace.firstSpeechReadyAt - synthesisStartedAt;
          page._activeVoiceTrace = voiceTrace;
        }
        if (!page._pageUnloaded) {
          page.setData({ speaking: true });
        }
        try {
          await deviceTtsService.play(synthesized.result.data);
        } catch (error) {
          if (!firstError) firstError = error;
          console.warn(`第 ${currentSegment} 段挂件播放失败，继续处理后续语音：`, error.message);
        }
      });
    },
    async finish() {
      await playbackChain;
      if (voiceTrace) {
        voiceTrace.completedAt = Date.now();
        voiceTrace.totalPipelineMs = voiceTrace.completedAt - voiceTrace.recordingStartedAt;
        if (page._activeVoiceTrace === voiceTrace) page._activeVoiceTrace = null;
      }
      if (firstError) throw firstError;
    }
  };
}

module.exports = { createStreamingSpeechQueue };

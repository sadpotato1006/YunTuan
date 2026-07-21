const DEFAULT_INTERVAL_MS = 80;

function createStreamReplyRenderer(page, options) {
  const settings = options || {};
  const interval = Math.max(16, Number(settings.interval) || DEFAULT_INTERVAL_MS);
  let timer = null;
  let pending = null;
  let initialized = false;

  function render() {
    if (!pending) return;
    const next = pending;
    pending = null;
    timer = null;
    const replyIndex = next.baseMessages.length;
    const messages = next.baseMessages.concat(next.reply);
    const data = Object.assign({}, next.uiState || {});
    if (!initialized) {
      data.messages = messages;
      initialized = true;
    } else {
      data[`messages[${replyIndex}].content`] = next.reply.content;
      data[`messages[${replyIndex}].status`] = next.reply.status;
    }
    page.setData(data);
    if (typeof settings.onPersist === "function") settings.onPersist(messages);
    if (typeof settings.onRendered === "function") settings.onRendered();
  }

  function schedule(value) {
    pending = value;
    if (timer) return;
    timer = setTimeout(render, interval);
  }

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    render();
  }

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  }

  return { schedule, flush, cancel };
}

module.exports = { createStreamReplyRenderer, DEFAULT_INTERVAL_MS };

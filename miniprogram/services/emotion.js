const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/emotion");

function invoke(action, mockFn, httpOptions, data) {
  const mode = config.getBackendMode("emotion");
  if (mode === "mock") return mockFn();
  if (mode === "cloud") return callCloudFunction("emotion", Object.assign({ action }, data || {}));
  if (mode === "http") return request(httpOptions);
  return Promise.reject(new Error(`未知的情绪后端模式：${mode}`));
}

function getEmotionRecords() {
  return invoke("getEmotionRecords", mock.getEmotionRecords, { url: "/emotions" });
}
function getEmotionOptions() {
  return invoke("getEmotionOptions", mock.getEmotionOptions, { url: "/emotions/options" });
}
function getEmotionSummary() {
  return invoke("getEmotionSummary", mock.getEmotionSummary, { url: "/emotions/latest" });
}
function addEmotionRecord(name, note) {
  return invoke(
    "addEmotionRecord",
    () => mock.addEmotionRecord(name, note),
    { url: "/emotions", method: "POST", data: { name, note } },
    { name, note }
  );
}

module.exports = { getEmotionRecords, getEmotionOptions, getEmotionSummary, addEmotionRecord };

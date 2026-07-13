const config = require("../config/index");
const request = require("../utils/request");
const callCloudFunction = require("../utils/cloud");
const mock = require("../mock/emotion");

function getEmotionRecords() {
  if (config.backendMode === "mock") return mock.getEmotionRecords();
  if (config.backendMode === "cloud") return callCloudFunction("emotion", { action: "getEmotionRecords" });
  return request({ url: "/emotions" });
}

module.exports = { getEmotionRecords };

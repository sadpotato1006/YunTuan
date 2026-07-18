const callCloudFunction = require("../utils/cloud");
const socialService = require("./social");

async function deleteCloudData() {
  const results = await Promise.all([
    callCloudFunction("chat", { action: "deleteMyChatData" }),
    callCloudFunction("emotion", { action: "deleteMyEmotionRecords" }),
    socialService.deleteMyData()
  ]);
  return {
    chatDeleted: Boolean(results[0].data && results[0].data.deleted),
    emotionsDeleted: Boolean(results[1].data && results[1].data.deleted),
    socialDeleted: Boolean(results[2] && results[2].deleted)
  };
}

module.exports = { deleteCloudData };

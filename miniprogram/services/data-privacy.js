const callCloudFunction = require("../utils/cloud");
const socialService = require("./social");

async function deleteCloudData() {
  const results = await Promise.all([
    callCloudFunction("chat", { action: "deleteMyChatData" }),
    socialService.deleteMyData()
  ]);
  return {
    chatDeleted: Boolean(results[0].data && results[0].data.deleted),
    socialDeleted: Boolean(results[1] && results[1].deleted)
  };
}

module.exports = { deleteCloudData };

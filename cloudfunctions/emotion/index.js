const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  // 后续可在这里读取微信云数据库中的情绪分析和历史记录。
  return { code: 0, message: "success", data: { records: [
    { id: 1, date: "7月13日", name: "平静", score: 82, note: "和家人通话后，心情安稳。" },
    { id: 2, date: "7月12日", name: "开心", score: 91, note: "散步时遇到了熟悉的邻居。" },
    { id: 3, date: "7月11日", name: "有点想念", score: 68, note: "聊起了家乡和老朋友。" }
  ] } };
};

const records = [
  { id: 1, date: "7月13日", name: "平静", score: 82, note: "和家人通话后，心情安稳。" },
  { id: 2, date: "7月12日", name: "开心", score: 91, note: "散步时遇到了熟悉的邻居。" },
  { id: 3, date: "7月11日", name: "有点想念", score: 68, note: "聊起了家乡和老朋友。" },
  { id: 4, date: "7月10日", name: "舒心", score: 86, note: "午后休息得很好。" }
];

function getEmotionRecords() {
  return new Promise(resolve => setTimeout(() => resolve({
    code: 0, message: "success", data: { records: records.slice() }
  }), 450));
}

module.exports = { getEmotionRecords };

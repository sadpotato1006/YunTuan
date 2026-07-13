const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

let device = { id: "YT-001", name: "云团陪伴挂件", connected: true, battery: 78, socialMode: true };

exports.main = async event => {
  const action = event.action || "getDevice";
  if (action === "bindDevice") device.connected = true;
  if (action === "disconnectDevice") device.connected = false;
  if (action === "setSocialMode") device.socialMode = Boolean(event.enabled);

  // 真实 BLE 扫描、连接和通信仍在小程序端进行；云函数未来只管理绑定关系和状态记录。
  if (action === "getHomeOverview") {
    return { code: 0, message: "success", data: {
      greeting: "您好，今天也要照顾好自己呀",
      careTip: "天气较热，记得及时喝水，午后可以稍作休息。",
      device
    } };
  }
  return { code: 0, message: "success", data: { device } };
};

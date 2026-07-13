let device = { id: "YT-001", name: "云团陪伴挂件", connected: true, battery: 78, socialMode: true };

function result(data, delay) {
  return new Promise(resolve => setTimeout(() => resolve({ code: 0, message: "success", data }), delay || 400));
}

function getDevice() { return result({ device: Object.assign({}, device) }); }
function getHomeOverview() {
  return result({
    greeting: "您好，今天也要照顾好自己呀",
    careTip: "天气较热，记得及时喝水，午后可以稍作休息。",
    device: Object.assign({}, device)
  }, 300);
}
function bindDevice() { device.connected = true; return result({ device: Object.assign({}, device) }, 700); }
function disconnectDevice() { device.connected = false; return result({ device: Object.assign({}, device) }, 500); }
function setSocialMode(enabled) { device.socialMode = enabled; return result({ device: Object.assign({}, device) }, 250); }

module.exports = { getDevice, getHomeOverview, bindDevice, disconnectDevice, setSocialMode };

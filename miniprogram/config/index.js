const profiles = require("./profiles");

function getEnvironmentVersion() {
  try {
    if (typeof wx !== "undefined" && typeof wx.getAccountInfoSync === "function") {
      const account = wx.getAccountInfoSync();
      const version = account && account.miniProgram && account.miniProgram.envVersion;
      if (profiles[version]) return version;
    }
  } catch (error) {}
  return "develop";
}

const environmentVersion = getEnvironmentVersion();
const selected = profiles[environmentVersion] || profiles.develop;
const config = Object.assign({}, selected, {
  environmentVersion,
  serviceBackendModes: Object.assign({}, selected.serviceBackendModes)
});

config.getBackendMode = function getBackendMode(serviceName) {
  return config.serviceBackendModes[serviceName] || config.backendMode;
};

config.usesCloudBackend = function usesCloudBackend() {
  return config.backendMode === "cloud" ||
    Object.keys(config.serviceBackendModes).some(name => config.serviceBackendModes[name] === "cloud");
};

module.exports = config;

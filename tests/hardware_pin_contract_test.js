const assert = require("assert");
const fs = require("fs");
const path = require("path");

const firmware = fs.readFileSync(
  path.join(__dirname, "..", "hard", "main.cpp"),
  "utf8"
);

// These values mirror the soldered A1 hardware. Changing any one of them is a
// hardware compatibility break and must never happen as part of a refactor.
const fixedPins = {
  PIN_BUTTON: 8,
  PIN_ALERT: 2,
  PIN_LED: 48,
  PIN_BATTERY_ADC: 1,
  PIN_MIC_BCLK: 9,
  PIN_MIC_WS: 46,
  PIN_MIC_SD: 4,
  PIN_SPEAKER_DIN: 10
};

Object.entries(fixedPins).forEach(([name, pin]) => {
  const definition = new RegExp(`^#define\\s+${name}\\s+${pin}\\b`, "m");
  assert.match(firmware, definition, `${name} must remain fixed at GPIO${pin}`);
});

assert.strictEqual(
  new Set(Object.values(fixedPins)).size,
  Object.keys(fixedPins).length,
  "fixed hardware functions must not share a GPIO"
);

console.log("hardware_pin_contract_test: ok");

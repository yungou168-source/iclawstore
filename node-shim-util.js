// Node 16 polyfill for Vite 8: provides parseEnv, formatWithOptions, stripVTControlCharacters
const originalUtil = require("util");

function parseEnv(content) {
  const result = {};
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function stripVTControlCharacters(str) {
  return String(str)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b[()][AB012]/g, "")
    .replace(/\x1b\[[0-9]?[AJK]/g, "");
}

function formatWithOptions(inspectOptions, ...args) {
  return originalUtil.formatWithOptions
    ? originalUtil.formatWithOptions.call({ inspectOptions }, ...args)
    : originalUtil.format(...args);
}

module.exports = {
  ...originalUtil,
  parseEnv,
  stripVTControlCharacters,
  formatWithOptions,
};

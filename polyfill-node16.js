// Polyfill for Node 16: provide styleText from node:util
const Module = require("module");
const originalLoad = Module._load;
Module._load = function (name, parent) {
  const mod = originalLoad.apply(this, arguments);
  if (name === "util" || name === "node:util") {
    if (!mod.styleText) {
      mod.styleText = function (style, text) {
        const s = String(style);
        if (
          s === "reset" ||
          s === "bold" ||
          s === "dim" ||
          s === "italic" ||
          s === "underline" ||
          s === "blink" ||
          s === "overline" ||
          s === "inverse"
        ) {
          return (
            "\x1b[" +
            {
              bold: 1,
              dim: 2,
              italic: 3,
              underline: 4,
              blink: 5,
              overline: 6,
              inverse: 7,
              reset: 0,
            }[s] +
            "m" +
            text +
            "\x1b[0m"
          );
        }
        if (
          s === "red" ||
          s === "green" ||
          s === "yellow" ||
          s === "blue" ||
          s === "magenta" ||
          s === "cyan" ||
          s === "white" ||
          s === "gray" ||
          s === "grey" ||
          s === "black" ||
          s === "bgBlack" ||
          s === "bgRed" ||
          s === "bgGreen" ||
          s === "bgYellow" ||
          s === "bgBlue" ||
          s === "bgMagenta" ||
          s === "bgCyan" ||
          s === "bgWhite"
        ) {
          const codes = {
            black: 30,
            red: 31,
            green: 32,
            yellow: 33,
            blue: 34,
            magenta: 35,
            cyan: 36,
            white: 37,
            gray: 90,
            grey: 90,
            bgBlack: 40,
            bgRed: 41,
            bgGreen: 42,
            bgYellow: 43,
            bgBlue: 44,
            bgMagenta: 45,
            bgCyan: 46,
            bgWhite: 47,
          };
          return "\x1b[" + (codes[s] || 0) + "m" + text + "\x1b[0m";
        }
        return text;
      };
    }
    if (!mod.formatWithOptions) {
      mod.formatWithOptions = function (opts, t, ...args) {
        return require("util").format.call({ inspectOptions: opts || {} }, t, ...args);
      };
    }
  }
  return mod;
};

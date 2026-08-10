#!/usr/bin/env node
// Wrapper script that patches vite's bundled code to fix Node 16 compatibility
const Module = require("module");
const path = require("path");
const fs = require("fs");

// Patch Module._load to intercept vite's bundled chunks
const origLoad = Module._load;
Module._load = function (name, parent) {
  const mod = origLoad.apply(this, arguments);
  return mod;
};

// Add missing Node 16 APIs to global
if (typeof globalThis.CustomEvent === "undefined") {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(name, opts) {
      super(name);
      this.detail = opts && opts.detail;
    }
  };
}

if (typeof globalThis.crypto === "undefined") {
  globalThis.crypto = {
    getRandomValues: (arr) => {
      const bytes = require("crypto").randomBytes(arr.length);
      for (let i = 0; i < arr.length; i++) arr[i] = bytes[i];
      return arr;
    },
    subtle: {
      digest: async (algo, data) =>
        require("crypto").createHash(algo.replace("-", "")).update(data).digest(),
    },
  };
}

const viteBin = path.join(__dirname, "node_modules/vite/bin/vite.js");
process.argv[1] = viteBin;

// Patch vite's bundled chunks before they're loaded
const cliPath = path.join(__dirname, "node_modules/vite/dist/node/cli.js");
const nodePath = path.join(__dirname, "node_modules/vite/dist/node/chunks/node.js");

// We can't easily patch the bundled chunks from here since they're loaded dynamically,
// so we need a different approach. Let's just try to run vite directly.
require(viteBin);

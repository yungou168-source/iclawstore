(function () {
  if (typeof globalThis.Headers === "undefined") {
    function HeadersPolyfill(init) {
      var fields = [];
      if (init) {
        if (Array.isArray(init)) {
          for (var i = 0; i < init.length; i++) fields.push([init[i][0].toLowerCase(), init[i][1]]);
        } else {
          for (var k in init) fields.push([k.toLowerCase(), init[k]]);
        }
      }
      this._fields = fields;
    }
    HeadersPolyfill.prototype.get = function (k) {
      for (var i = 0; i < this._fields.length; i++)
        if (this._fields[i][0] === String(k).toLowerCase()) return this._fields[i][1];
      return null;
    };
    HeadersPolyfill.prototype.has = function (k) {
      for (var i = 0; i < this._fields.length; i++)
        if (this._fields[i][0] === String(k).toLowerCase()) return true;
      return false;
    };
    HeadersPolyfill.prototype.set = function (k, v) {
      for (var i = 0; i < this._fields.length; i++)
        if (this._fields[i][0] === String(k).toLowerCase()) {
          this._fields[i][1] = v;
          return;
        }
      this._fields.push([String(k).toLowerCase(), v]);
    };
    HeadersPolyfill.prototype.append = function (k, v) {
      for (var i = 0; i < this._fields.length; i++)
        if (this._fields[i][0] === String(k).toLowerCase()) {
          this._fields[i][1] += ", " + v;
          return;
        }
      this._fields.push([String(k).toLowerCase(), v]);
    };
    HeadersPolyfill.prototype.entries = function () {
      return this._fields;
    };
    HeadersPolyfill.prototype.keys = function () {
      return this._fields.map(function (f) {
        return [f[0], f[1]];
      });
    };
    HeadersPolyfill.prototype.values = function () {
      return this._fields.map(function (f) {
        return f[1];
      });
    };
    HeadersPolyfill.prototype[Symbol.iterator] = function () {
      return this._fields;
    };

    globalThis.Headers = HeadersPolyfill;

    globalThis.Response = function ResponsePolyfill(body, init) {
      this.body = body;
      this.status = (init && init.status) || 200;
      this.statusText = (init && init.statusText) || "OK";
      this.headers =
        init && init.headers ? new HeadersPolyfill(init.headers) : new HeadersPolyfill();
    };
    Object.defineProperty(globalThis.Response.prototype, "ok", {
      get: function () {
        return this.status >= 200 && this.status < 300;
      },
    });
    globalThis.Response.prototype.text = function () {
      return Promise.resolve(String(this.body || ""));
    };
    globalThis.Response.prototype.json = function () {
      return Promise.resolve(JSON.parse(String(this.body || "")));
    };
    globalThis.Response.prototype.arrayBuffer = function () {
      return Promise.resolve(new TextEncoder().encode(String(this.body || "")).buffer);
    };

    globalThis.Request = function RequestPolyfill(input, init) {
      this.url = typeof input === "string" ? input : input && input.url;
      this.method = (init && init.method) || "GET";
      this.headers =
        init && init.headers ? new HeadersPolyfill(init.headers) : new HeadersPolyfill();
      this.body = init && init.body;
    };
  }

  if (typeof globalThis.Blob === "undefined") {
    globalThis.Blob = function BlobPolyfill(parts, opts) {
      this._parts = parts || [];
      this._type = opts && opts.type ? String(opts.type) : "";
    };
    Object.defineProperty(globalThis.Blob.prototype, "type", {
      get: function () {
        return this._type;
      },
    });
    Object.defineProperty(globalThis.Blob.prototype, "size", {
      get: function () {
        var s = 0;
        for (var i = 0; i < this._parts.length; i++) {
          var p = this._parts[i];
          if (typeof p === "string") s += p.length;
          else if (p instanceof ArrayBuffer) s += p.byteLength;
          else if (p instanceof Uint8Array) s += p.length;
        }
        return s;
      },
    });
    globalThis.Blob.prototype.text = function () {
      var parts = this._parts;
      return Promise.resolve(
        parts
          .map(function (p) {
            return typeof p === "string"
              ? p
              : new TextDecoder().decode(p instanceof ArrayBuffer ? new Uint8Array(p) : p);
          })
          .join(""),
      );
    };
  }

  if (typeof globalThis.File === "undefined") {
    globalThis.File = function FilePolyfill(parts, name, opts) {
      globalThis.Blob.call(this, parts, opts);
      this._name = name;
      this._lastModified = opts && opts.lastModified !== undefined ? opts.lastModified : Date.now();
    };
    globalThis.File.prototype = Object.create(globalThis.Blob.prototype);
    globalThis.File.prototype.constructor = globalThis.File;
    Object.defineProperty(globalThis.File.prototype, "name", {
      get: function () {
        return this._name;
      },
    });
    Object.defineProperty(globalThis.File.prototype, "lastModified", {
      get: function () {
        return this._lastModified;
      },
    });
  }

  if (typeof globalThis.FormData === "undefined") {
    globalThis.FormData = function FormDataPolyfill() {
      this._fields = [];
    };
    globalThis.FormData.prototype.append = function (k, v, fn) {
      this._fields.push({ key: k, value: v, filename: fn });
    };
    globalThis.FormData.prototype.get = function (k) {
      for (var i = 0; i < this._fields.length; i++)
        if (this._fields[i].key === k) return this._fields[i].value;
      return null;
    };
    globalThis.FormData.prototype.getAll = function (k) {
      return this._fields
        .filter(function (f) {
          return f.key === k;
        })
        .map(function (f) {
          return f.value;
        });
    };
    globalThis.FormData.prototype.has = function (k) {
      return this._fields.some(function (f) {
        return f.key === k;
      });
    };
    globalThis.FormData.prototype.set = function (k, v, fn) {
      this._fields = [{ key: k, value: v, filename: fn }];
    };
    globalThis.FormData.prototype.delete = function (k) {
      this._fields = this._fields.filter(function (f) {
        return f.key !== k;
      });
    };
    globalThis.FormData.prototype.entries = function () {
      return this._fields.map(function (f) {
        return [f.key, f.value];
      });
    };
    globalThis.FormData.prototype.keys = function () {
      return this._fields.map(function (f) {
        return f.key;
      });
    };
    globalThis.FormData.prototype.values = function () {
      return this._fields.map(function (f) {
        return f.value;
      });
    };
    globalThis.FormData.prototype[Symbol.iterator] = function () {
      return this.entries();
    };
  }
})();

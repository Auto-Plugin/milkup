"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/constants.js
var require_constants = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/constants.js"(exports2, module2) {
    "use strict";
    var SEMVER_SPEC_VERSION = "2.0.0";
    var MAX_LENGTH = 256;
    var MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER || /* istanbul ignore next */
    9007199254740991;
    var MAX_SAFE_COMPONENT_LENGTH = 16;
    var MAX_SAFE_BUILD_LENGTH = MAX_LENGTH - 6;
    var RELEASE_TYPES = [
      "major",
      "premajor",
      "minor",
      "preminor",
      "patch",
      "prepatch",
      "prerelease"
    ];
    module2.exports = {
      MAX_LENGTH,
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_SAFE_INTEGER,
      RELEASE_TYPES,
      SEMVER_SPEC_VERSION,
      FLAG_INCLUDE_PRERELEASE: 1,
      FLAG_LOOSE: 2
    };
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/debug.js
var require_debug = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/debug.js"(exports2, module2) {
    "use strict";
    var debug = typeof process === "object" && process.env && process.env.NODE_DEBUG && /\bsemver\b/i.test(process.env.NODE_DEBUG) ? (...args) => console.error("SEMVER", ...args) : () => {
    };
    module2.exports = debug;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/re.js
var require_re = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/re.js"(exports2, module2) {
    "use strict";
    var {
      MAX_SAFE_COMPONENT_LENGTH,
      MAX_SAFE_BUILD_LENGTH,
      MAX_LENGTH
    } = require_constants();
    var debug = require_debug();
    exports2 = module2.exports = {};
    var re = exports2.re = [];
    var safeRe = exports2.safeRe = [];
    var src = exports2.src = [];
    var safeSrc = exports2.safeSrc = [];
    var t = exports2.t = {};
    var R = 0;
    var LETTERDASHNUMBER = "[a-zA-Z0-9-]";
    var safeRegexReplacements = [
      ["\\s", 1],
      ["\\d", MAX_LENGTH],
      [LETTERDASHNUMBER, MAX_SAFE_BUILD_LENGTH]
    ];
    var makeSafeRegex = (value) => {
      for (const [token, max] of safeRegexReplacements) {
        value = value.split(`${token}*`).join(`${token}{0,${max}}`).split(`${token}+`).join(`${token}{1,${max}}`);
      }
      return value;
    };
    var createToken = (name, value, isGlobal) => {
      const safe = makeSafeRegex(value);
      const index = R++;
      debug(name, index, value);
      t[name] = index;
      src[index] = value;
      safeSrc[index] = safe;
      re[index] = new RegExp(value, isGlobal ? "g" : void 0);
      safeRe[index] = new RegExp(safe, isGlobal ? "g" : void 0);
    };
    createToken("NUMERICIDENTIFIER", "0|[1-9]\\d*");
    createToken("NUMERICIDENTIFIERLOOSE", "\\d+");
    createToken("NONNUMERICIDENTIFIER", `\\d*[a-zA-Z-]${LETTERDASHNUMBER}*`);
    createToken("MAINVERSION", `(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})\\.(${src[t.NUMERICIDENTIFIER]})`);
    createToken("MAINVERSIONLOOSE", `(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})\\.(${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASEIDENTIFIER", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIER]})`);
    createToken("PRERELEASEIDENTIFIERLOOSE", `(?:${src[t.NONNUMERICIDENTIFIER]}|${src[t.NUMERICIDENTIFIERLOOSE]})`);
    createToken("PRERELEASE", `(?:-(${src[t.PRERELEASEIDENTIFIER]}(?:\\.${src[t.PRERELEASEIDENTIFIER]})*))`);
    createToken("PRERELEASELOOSE", `(?:-?(${src[t.PRERELEASEIDENTIFIERLOOSE]}(?:\\.${src[t.PRERELEASEIDENTIFIERLOOSE]})*))`);
    createToken("BUILDIDENTIFIER", `${LETTERDASHNUMBER}+`);
    createToken("BUILD", `(?:\\+(${src[t.BUILDIDENTIFIER]}(?:\\.${src[t.BUILDIDENTIFIER]})*))`);
    createToken("FULLPLAIN", `v?${src[t.MAINVERSION]}${src[t.PRERELEASE]}?${src[t.BUILD]}?`);
    createToken("FULL", `^${src[t.FULLPLAIN]}$`);
    createToken("LOOSEPLAIN", `[v=\\s]*${src[t.MAINVERSIONLOOSE]}${src[t.PRERELEASELOOSE]}?${src[t.BUILD]}?`);
    createToken("LOOSE", `^${src[t.LOOSEPLAIN]}$`);
    createToken("GTLT", "((?:<|>)?=?)");
    createToken("XRANGEIDENTIFIERLOOSE", `${src[t.NUMERICIDENTIFIERLOOSE]}|x|X|\\*`);
    createToken("XRANGEIDENTIFIER", `${src[t.NUMERICIDENTIFIER]}|x|X|\\*`);
    createToken("XRANGEPLAIN", `[v=\\s]*(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:\\.(${src[t.XRANGEIDENTIFIER]})(?:${src[t.PRERELEASE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGEPLAINLOOSE", `[v=\\s]*(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:\\.(${src[t.XRANGEIDENTIFIERLOOSE]})(?:${src[t.PRERELEASELOOSE]})?${src[t.BUILD]}?)?)?`);
    createToken("XRANGE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAIN]}$`);
    createToken("XRANGELOOSE", `^${src[t.GTLT]}\\s*${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COERCEPLAIN", `${"(^|[^\\d])(\\d{1,"}${MAX_SAFE_COMPONENT_LENGTH}})(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?(?:\\.(\\d{1,${MAX_SAFE_COMPONENT_LENGTH}}))?`);
    createToken("COERCE", `${src[t.COERCEPLAIN]}(?:$|[^\\d])`);
    createToken("COERCEFULL", src[t.COERCEPLAIN] + `(?:${src[t.PRERELEASE]})?(?:${src[t.BUILD]})?(?:$|[^\\d])`);
    createToken("COERCERTL", src[t.COERCE], true);
    createToken("COERCERTLFULL", src[t.COERCEFULL], true);
    createToken("LONETILDE", "(?:~>?)");
    createToken("TILDETRIM", `(\\s*)${src[t.LONETILDE]}\\s+`, true);
    exports2.tildeTrimReplace = "$1~";
    createToken("TILDE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAIN]}$`);
    createToken("TILDELOOSE", `^${src[t.LONETILDE]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("LONECARET", "(?:\\^)");
    createToken("CARETTRIM", `(\\s*)${src[t.LONECARET]}\\s+`, true);
    exports2.caretTrimReplace = "$1^";
    createToken("CARET", `^${src[t.LONECARET]}${src[t.XRANGEPLAIN]}$`);
    createToken("CARETLOOSE", `^${src[t.LONECARET]}${src[t.XRANGEPLAINLOOSE]}$`);
    createToken("COMPARATORLOOSE", `^${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]})$|^$`);
    createToken("COMPARATOR", `^${src[t.GTLT]}\\s*(${src[t.FULLPLAIN]})$|^$`);
    createToken("COMPARATORTRIM", `(\\s*)${src[t.GTLT]}\\s*(${src[t.LOOSEPLAIN]}|${src[t.XRANGEPLAIN]})`, true);
    exports2.comparatorTrimReplace = "$1$2$3";
    createToken("HYPHENRANGE", `^\\s*(${src[t.XRANGEPLAIN]})\\s+-\\s+(${src[t.XRANGEPLAIN]})\\s*$`);
    createToken("HYPHENRANGELOOSE", `^\\s*(${src[t.XRANGEPLAINLOOSE]})\\s+-\\s+(${src[t.XRANGEPLAINLOOSE]})\\s*$`);
    createToken("STAR", "(<|>)?=?\\s*\\*");
    createToken("GTE0", "^\\s*>=\\s*0\\.0\\.0\\s*$");
    createToken("GTE0PRE", "^\\s*>=\\s*0\\.0\\.0-0\\s*$");
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/parse-options.js
var require_parse_options = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/parse-options.js"(exports2, module2) {
    "use strict";
    var looseOption = Object.freeze({ loose: true });
    var emptyOpts = Object.freeze({});
    var parseOptions = (options) => {
      if (!options) {
        return emptyOpts;
      }
      if (typeof options !== "object") {
        return looseOption;
      }
      return options;
    };
    module2.exports = parseOptions;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/identifiers.js
var require_identifiers = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/identifiers.js"(exports2, module2) {
    "use strict";
    var numeric = /^[0-9]+$/;
    var compareIdentifiers = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return a === b ? 0 : a < b ? -1 : 1;
      }
      const anum = numeric.test(a);
      const bnum = numeric.test(b);
      if (anum && bnum) {
        a = +a;
        b = +b;
      }
      return a === b ? 0 : anum && !bnum ? -1 : bnum && !anum ? 1 : a < b ? -1 : 1;
    };
    var rcompareIdentifiers = (a, b) => compareIdentifiers(b, a);
    module2.exports = {
      compareIdentifiers,
      rcompareIdentifiers
    };
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/classes/semver.js
var require_semver = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/classes/semver.js"(exports2, module2) {
    "use strict";
    var debug = require_debug();
    var { MAX_LENGTH, MAX_SAFE_INTEGER } = require_constants();
    var { safeRe: re, t } = require_re();
    var parseOptions = require_parse_options();
    var { compareIdentifiers } = require_identifiers();
    var SemVer = class _SemVer {
      constructor(version, options) {
        options = parseOptions(options);
        if (version instanceof _SemVer) {
          if (version.loose === !!options.loose && version.includePrerelease === !!options.includePrerelease) {
            return version;
          } else {
            version = version.version;
          }
        } else if (typeof version !== "string") {
          throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
        }
        if (version.length > MAX_LENGTH) {
          throw new TypeError(
            `version is longer than ${MAX_LENGTH} characters`
          );
        }
        debug("SemVer", version, options);
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        const m = version.trim().match(options.loose ? re[t.LOOSE] : re[t.FULL]);
        if (!m) {
          throw new TypeError(`Invalid Version: ${version}`);
        }
        this.raw = version;
        this.major = +m[1];
        this.minor = +m[2];
        this.patch = +m[3];
        if (this.major > MAX_SAFE_INTEGER || this.major < 0) {
          throw new TypeError("Invalid major version");
        }
        if (this.minor > MAX_SAFE_INTEGER || this.minor < 0) {
          throw new TypeError("Invalid minor version");
        }
        if (this.patch > MAX_SAFE_INTEGER || this.patch < 0) {
          throw new TypeError("Invalid patch version");
        }
        if (!m[4]) {
          this.prerelease = [];
        } else {
          this.prerelease = m[4].split(".").map((id) => {
            if (/^[0-9]+$/.test(id)) {
              const num = +id;
              if (num >= 0 && num < MAX_SAFE_INTEGER) {
                return num;
              }
            }
            return id;
          });
        }
        this.build = m[5] ? m[5].split(".") : [];
        this.format();
      }
      format() {
        this.version = `${this.major}.${this.minor}.${this.patch}`;
        if (this.prerelease.length) {
          this.version += `-${this.prerelease.join(".")}`;
        }
        return this.version;
      }
      toString() {
        return this.version;
      }
      compare(other) {
        debug("SemVer.compare", this.version, this.options, other);
        if (!(other instanceof _SemVer)) {
          if (typeof other === "string" && other === this.version) {
            return 0;
          }
          other = new _SemVer(other, this.options);
        }
        if (other.version === this.version) {
          return 0;
        }
        return this.compareMain(other) || this.comparePre(other);
      }
      compareMain(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.major < other.major) {
          return -1;
        }
        if (this.major > other.major) {
          return 1;
        }
        if (this.minor < other.minor) {
          return -1;
        }
        if (this.minor > other.minor) {
          return 1;
        }
        if (this.patch < other.patch) {
          return -1;
        }
        if (this.patch > other.patch) {
          return 1;
        }
        return 0;
      }
      comparePre(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        if (this.prerelease.length && !other.prerelease.length) {
          return -1;
        } else if (!this.prerelease.length && other.prerelease.length) {
          return 1;
        } else if (!this.prerelease.length && !other.prerelease.length) {
          return 0;
        }
        let i = 0;
        do {
          const a = this.prerelease[i];
          const b = other.prerelease[i];
          debug("prerelease compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      compareBuild(other) {
        if (!(other instanceof _SemVer)) {
          other = new _SemVer(other, this.options);
        }
        let i = 0;
        do {
          const a = this.build[i];
          const b = other.build[i];
          debug("build compare", i, a, b);
          if (a === void 0 && b === void 0) {
            return 0;
          } else if (b === void 0) {
            return 1;
          } else if (a === void 0) {
            return -1;
          } else if (a === b) {
            continue;
          } else {
            return compareIdentifiers(a, b);
          }
        } while (++i);
      }
      // preminor will bump the version up to the next minor release, and immediately
      // down to pre-release. premajor and prepatch work the same way.
      inc(release, identifier, identifierBase) {
        if (release.startsWith("pre")) {
          if (!identifier && identifierBase === false) {
            throw new Error("invalid increment argument: identifier is empty");
          }
          if (identifier) {
            const match = `-${identifier}`.match(this.options.loose ? re[t.PRERELEASELOOSE] : re[t.PRERELEASE]);
            if (!match || match[1] !== identifier) {
              throw new Error(`invalid identifier: ${identifier}`);
            }
          }
        }
        switch (release) {
          case "premajor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor = 0;
            this.major++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "preminor":
            this.prerelease.length = 0;
            this.patch = 0;
            this.minor++;
            this.inc("pre", identifier, identifierBase);
            break;
          case "prepatch":
            this.prerelease.length = 0;
            this.inc("patch", identifier, identifierBase);
            this.inc("pre", identifier, identifierBase);
            break;
          // If the input is a non-prerelease version, this acts the same as
          // prepatch.
          case "prerelease":
            if (this.prerelease.length === 0) {
              this.inc("patch", identifier, identifierBase);
            }
            this.inc("pre", identifier, identifierBase);
            break;
          case "release":
            if (this.prerelease.length === 0) {
              throw new Error(`version ${this.raw} is not a prerelease`);
            }
            this.prerelease.length = 0;
            break;
          case "major":
            if (this.minor !== 0 || this.patch !== 0 || this.prerelease.length === 0) {
              this.major++;
            }
            this.minor = 0;
            this.patch = 0;
            this.prerelease = [];
            break;
          case "minor":
            if (this.patch !== 0 || this.prerelease.length === 0) {
              this.minor++;
            }
            this.patch = 0;
            this.prerelease = [];
            break;
          case "patch":
            if (this.prerelease.length === 0) {
              this.patch++;
            }
            this.prerelease = [];
            break;
          // This probably shouldn't be used publicly.
          // 1.0.0 'pre' would become 1.0.0-0 which is the wrong direction.
          case "pre": {
            const base = Number(identifierBase) ? 1 : 0;
            if (this.prerelease.length === 0) {
              this.prerelease = [base];
            } else {
              let i = this.prerelease.length;
              while (--i >= 0) {
                if (typeof this.prerelease[i] === "number") {
                  this.prerelease[i]++;
                  i = -2;
                }
              }
              if (i === -1) {
                if (identifier === this.prerelease.join(".") && identifierBase === false) {
                  throw new Error("invalid increment argument: identifier already exists");
                }
                this.prerelease.push(base);
              }
            }
            if (identifier) {
              let prerelease = [identifier, base];
              if (identifierBase === false) {
                prerelease = [identifier];
              }
              if (compareIdentifiers(this.prerelease[0], identifier) === 0) {
                if (isNaN(this.prerelease[1])) {
                  this.prerelease = prerelease;
                }
              } else {
                this.prerelease = prerelease;
              }
            }
            break;
          }
          default:
            throw new Error(`invalid increment argument: ${release}`);
        }
        this.raw = this.format();
        if (this.build.length) {
          this.raw += `+${this.build.join(".")}`;
        }
        return this;
      }
    };
    module2.exports = SemVer;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/parse.js
var require_parse = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/parse.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var parse = (version, options, throwErrors = false) => {
      if (version instanceof SemVer) {
        return version;
      }
      try {
        return new SemVer(version, options);
      } catch (er) {
        if (!throwErrors) {
          return null;
        }
        throw er;
      }
    };
    module2.exports = parse;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/valid.js
var require_valid = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/valid.js"(exports2, module2) {
    "use strict";
    var parse = require_parse();
    var valid2 = (version, options) => {
      const v = parse(version, options);
      return v ? v.version : null;
    };
    module2.exports = valid2;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/clean.js
var require_clean = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/clean.js"(exports2, module2) {
    "use strict";
    var parse = require_parse();
    var clean = (version, options) => {
      const s = parse(version.trim().replace(/^[=v]+/, ""), options);
      return s ? s.version : null;
    };
    module2.exports = clean;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/inc.js
var require_inc = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/inc.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var inc = (version, release, options, identifier, identifierBase) => {
      if (typeof options === "string") {
        identifierBase = identifier;
        identifier = options;
        options = void 0;
      }
      try {
        return new SemVer(
          version instanceof SemVer ? version.version : version,
          options
        ).inc(release, identifier, identifierBase).version;
      } catch (er) {
        return null;
      }
    };
    module2.exports = inc;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/diff.js
var require_diff = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/diff.js"(exports2, module2) {
    "use strict";
    var parse = require_parse();
    var diff = (version1, version2) => {
      const v1 = parse(version1, null, true);
      const v2 = parse(version2, null, true);
      const comparison = v1.compare(v2);
      if (comparison === 0) {
        return null;
      }
      const v1Higher = comparison > 0;
      const highVersion = v1Higher ? v1 : v2;
      const lowVersion = v1Higher ? v2 : v1;
      const highHasPre = !!highVersion.prerelease.length;
      const lowHasPre = !!lowVersion.prerelease.length;
      if (lowHasPre && !highHasPre) {
        if (!lowVersion.patch && !lowVersion.minor) {
          return "major";
        }
        if (lowVersion.compareMain(highVersion) === 0) {
          if (lowVersion.minor && !lowVersion.patch) {
            return "minor";
          }
          return "patch";
        }
      }
      const prefix = highHasPre ? "pre" : "";
      if (v1.major !== v2.major) {
        return prefix + "major";
      }
      if (v1.minor !== v2.minor) {
        return prefix + "minor";
      }
      if (v1.patch !== v2.patch) {
        return prefix + "patch";
      }
      return "prerelease";
    };
    module2.exports = diff;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/major.js
var require_major = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/major.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var major = (a, loose) => new SemVer(a, loose).major;
    module2.exports = major;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/minor.js
var require_minor = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/minor.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var minor = (a, loose) => new SemVer(a, loose).minor;
    module2.exports = minor;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/patch.js
var require_patch = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/patch.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var patch = (a, loose) => new SemVer(a, loose).patch;
    module2.exports = patch;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/prerelease.js
var require_prerelease = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/prerelease.js"(exports2, module2) {
    "use strict";
    var parse = require_parse();
    var prerelease = (version, options) => {
      const parsed = parse(version, options);
      return parsed && parsed.prerelease.length ? parsed.prerelease : null;
    };
    module2.exports = prerelease;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/compare.js
var require_compare = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/compare.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var compare = (a, b, loose) => new SemVer(a, loose).compare(new SemVer(b, loose));
    module2.exports = compare;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/rcompare.js
var require_rcompare = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/rcompare.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var rcompare = (a, b, loose) => compare(b, a, loose);
    module2.exports = rcompare;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/compare-loose.js
var require_compare_loose = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/compare-loose.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var compareLoose = (a, b) => compare(a, b, true);
    module2.exports = compareLoose;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/compare-build.js
var require_compare_build = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/compare-build.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var compareBuild = (a, b, loose) => {
      const versionA = new SemVer(a, loose);
      const versionB = new SemVer(b, loose);
      return versionA.compare(versionB) || versionA.compareBuild(versionB);
    };
    module2.exports = compareBuild;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/sort.js
var require_sort = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/sort.js"(exports2, module2) {
    "use strict";
    var compareBuild = require_compare_build();
    var sort = (list, loose) => list.sort((a, b) => compareBuild(a, b, loose));
    module2.exports = sort;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/rsort.js
var require_rsort = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/rsort.js"(exports2, module2) {
    "use strict";
    var compareBuild = require_compare_build();
    var rsort = (list, loose) => list.sort((a, b) => compareBuild(b, a, loose));
    module2.exports = rsort;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/gt.js
var require_gt = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/gt.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var gt = (a, b, loose) => compare(a, b, loose) > 0;
    module2.exports = gt;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/lt.js
var require_lt = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/lt.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var lt = (a, b, loose) => compare(a, b, loose) < 0;
    module2.exports = lt;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/eq.js
var require_eq = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/eq.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var eq = (a, b, loose) => compare(a, b, loose) === 0;
    module2.exports = eq;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/neq.js
var require_neq = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/neq.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var neq = (a, b, loose) => compare(a, b, loose) !== 0;
    module2.exports = neq;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/gte.js
var require_gte = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/gte.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var gte = (a, b, loose) => compare(a, b, loose) >= 0;
    module2.exports = gte;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/lte.js
var require_lte = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/lte.js"(exports2, module2) {
    "use strict";
    var compare = require_compare();
    var lte = (a, b, loose) => compare(a, b, loose) <= 0;
    module2.exports = lte;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/cmp.js
var require_cmp = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/cmp.js"(exports2, module2) {
    "use strict";
    var eq = require_eq();
    var neq = require_neq();
    var gt = require_gt();
    var gte = require_gte();
    var lt = require_lt();
    var lte = require_lte();
    var cmp = (a, op, b, loose) => {
      switch (op) {
        case "===":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a === b;
        case "!==":
          if (typeof a === "object") {
            a = a.version;
          }
          if (typeof b === "object") {
            b = b.version;
          }
          return a !== b;
        case "":
        case "=":
        case "==":
          return eq(a, b, loose);
        case "!=":
          return neq(a, b, loose);
        case ">":
          return gt(a, b, loose);
        case ">=":
          return gte(a, b, loose);
        case "<":
          return lt(a, b, loose);
        case "<=":
          return lte(a, b, loose);
        default:
          throw new TypeError(`Invalid operator: ${op}`);
      }
    };
    module2.exports = cmp;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/coerce.js
var require_coerce = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/coerce.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var parse = require_parse();
    var { safeRe: re, t } = require_re();
    var coerce = (version, options) => {
      if (version instanceof SemVer) {
        return version;
      }
      if (typeof version === "number") {
        version = String(version);
      }
      if (typeof version !== "string") {
        return null;
      }
      options = options || {};
      let match = null;
      if (!options.rtl) {
        match = version.match(options.includePrerelease ? re[t.COERCEFULL] : re[t.COERCE]);
      } else {
        const coerceRtlRegex = options.includePrerelease ? re[t.COERCERTLFULL] : re[t.COERCERTL];
        let next;
        while ((next = coerceRtlRegex.exec(version)) && (!match || match.index + match[0].length !== version.length)) {
          if (!match || next.index + next[0].length !== match.index + match[0].length) {
            match = next;
          }
          coerceRtlRegex.lastIndex = next.index + next[1].length + next[2].length;
        }
        coerceRtlRegex.lastIndex = -1;
      }
      if (match === null) {
        return null;
      }
      const major = match[2];
      const minor = match[3] || "0";
      const patch = match[4] || "0";
      const prerelease = options.includePrerelease && match[5] ? `-${match[5]}` : "";
      const build = options.includePrerelease && match[6] ? `+${match[6]}` : "";
      return parse(`${major}.${minor}.${patch}${prerelease}${build}`, options);
    };
    module2.exports = coerce;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/lrucache.js
var require_lrucache = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/internal/lrucache.js"(exports2, module2) {
    "use strict";
    var LRUCache = class {
      constructor() {
        this.max = 1e3;
        this.map = /* @__PURE__ */ new Map();
      }
      get(key) {
        const value = this.map.get(key);
        if (value === void 0) {
          return void 0;
        } else {
          this.map.delete(key);
          this.map.set(key, value);
          return value;
        }
      }
      delete(key) {
        return this.map.delete(key);
      }
      set(key, value) {
        const deleted = this.delete(key);
        if (!deleted && value !== void 0) {
          if (this.map.size >= this.max) {
            const firstKey = this.map.keys().next().value;
            this.delete(firstKey);
          }
          this.map.set(key, value);
        }
        return this;
      }
    };
    module2.exports = LRUCache;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/classes/range.js
var require_range = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/classes/range.js"(exports2, module2) {
    "use strict";
    var SPACE_CHARACTERS = /\s+/g;
    var Range = class _Range {
      constructor(range, options) {
        options = parseOptions(options);
        if (range instanceof _Range) {
          if (range.loose === !!options.loose && range.includePrerelease === !!options.includePrerelease) {
            return range;
          } else {
            return new _Range(range.raw, options);
          }
        }
        if (range instanceof Comparator) {
          this.raw = range.value;
          this.set = [[range]];
          this.formatted = void 0;
          return this;
        }
        this.options = options;
        this.loose = !!options.loose;
        this.includePrerelease = !!options.includePrerelease;
        this.raw = range.trim().replace(SPACE_CHARACTERS, " ");
        this.set = this.raw.split("||").map((r) => this.parseRange(r.trim())).filter((c) => c.length);
        if (!this.set.length) {
          throw new TypeError(`Invalid SemVer Range: ${this.raw}`);
        }
        if (this.set.length > 1) {
          const first = this.set[0];
          this.set = this.set.filter((c) => !isNullSet(c[0]));
          if (this.set.length === 0) {
            this.set = [first];
          } else if (this.set.length > 1) {
            for (const c of this.set) {
              if (c.length === 1 && isAny(c[0])) {
                this.set = [c];
                break;
              }
            }
          }
        }
        this.formatted = void 0;
      }
      get range() {
        if (this.formatted === void 0) {
          this.formatted = "";
          for (let i = 0; i < this.set.length; i++) {
            if (i > 0) {
              this.formatted += "||";
            }
            const comps = this.set[i];
            for (let k = 0; k < comps.length; k++) {
              if (k > 0) {
                this.formatted += " ";
              }
              this.formatted += comps[k].toString().trim();
            }
          }
        }
        return this.formatted;
      }
      format() {
        return this.range;
      }
      toString() {
        return this.range;
      }
      parseRange(range) {
        const memoOpts = (this.options.includePrerelease && FLAG_INCLUDE_PRERELEASE) | (this.options.loose && FLAG_LOOSE);
        const memoKey = memoOpts + ":" + range;
        const cached = cache.get(memoKey);
        if (cached) {
          return cached;
        }
        const loose = this.options.loose;
        const hr = loose ? re[t.HYPHENRANGELOOSE] : re[t.HYPHENRANGE];
        range = range.replace(hr, hyphenReplace(this.options.includePrerelease));
        debug("hyphen replace", range);
        range = range.replace(re[t.COMPARATORTRIM], comparatorTrimReplace);
        debug("comparator trim", range);
        range = range.replace(re[t.TILDETRIM], tildeTrimReplace);
        debug("tilde trim", range);
        range = range.replace(re[t.CARETTRIM], caretTrimReplace);
        debug("caret trim", range);
        let rangeList = range.split(" ").map((comp) => parseComparator(comp, this.options)).join(" ").split(/\s+/).map((comp) => replaceGTE0(comp, this.options));
        if (loose) {
          rangeList = rangeList.filter((comp) => {
            debug("loose invalid filter", comp, this.options);
            return !!comp.match(re[t.COMPARATORLOOSE]);
          });
        }
        debug("range list", rangeList);
        const rangeMap = /* @__PURE__ */ new Map();
        const comparators = rangeList.map((comp) => new Comparator(comp, this.options));
        for (const comp of comparators) {
          if (isNullSet(comp)) {
            return [comp];
          }
          rangeMap.set(comp.value, comp);
        }
        if (rangeMap.size > 1 && rangeMap.has("")) {
          rangeMap.delete("");
        }
        const result = [...rangeMap.values()];
        cache.set(memoKey, result);
        return result;
      }
      intersects(range, options) {
        if (!(range instanceof _Range)) {
          throw new TypeError("a Range is required");
        }
        return this.set.some((thisComparators) => {
          return isSatisfiable(thisComparators, options) && range.set.some((rangeComparators) => {
            return isSatisfiable(rangeComparators, options) && thisComparators.every((thisComparator) => {
              return rangeComparators.every((rangeComparator) => {
                return thisComparator.intersects(rangeComparator, options);
              });
            });
          });
        });
      }
      // if ANY of the sets match ALL of its comparators, then pass
      test(version) {
        if (!version) {
          return false;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        for (let i = 0; i < this.set.length; i++) {
          if (testSet(this.set[i], version, this.options)) {
            return true;
          }
        }
        return false;
      }
    };
    module2.exports = Range;
    var LRU = require_lrucache();
    var cache = new LRU();
    var parseOptions = require_parse_options();
    var Comparator = require_comparator();
    var debug = require_debug();
    var SemVer = require_semver();
    var {
      safeRe: re,
      t,
      comparatorTrimReplace,
      tildeTrimReplace,
      caretTrimReplace
    } = require_re();
    var { FLAG_INCLUDE_PRERELEASE, FLAG_LOOSE } = require_constants();
    var isNullSet = (c) => c.value === "<0.0.0-0";
    var isAny = (c) => c.value === "";
    var isSatisfiable = (comparators, options) => {
      let result = true;
      const remainingComparators = comparators.slice();
      let testComparator = remainingComparators.pop();
      while (result && remainingComparators.length) {
        result = remainingComparators.every((otherComparator) => {
          return testComparator.intersects(otherComparator, options);
        });
        testComparator = remainingComparators.pop();
      }
      return result;
    };
    var parseComparator = (comp, options) => {
      comp = comp.replace(re[t.BUILD], "");
      debug("comp", comp, options);
      comp = replaceCarets(comp, options);
      debug("caret", comp);
      comp = replaceTildes(comp, options);
      debug("tildes", comp);
      comp = replaceXRanges(comp, options);
      debug("xrange", comp);
      comp = replaceStars(comp, options);
      debug("stars", comp);
      return comp;
    };
    var isX = (id) => !id || id.toLowerCase() === "x" || id === "*";
    var replaceTildes = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceTilde(c, options)).join(" ");
    };
    var replaceTilde = (comp, options) => {
      const r = options.loose ? re[t.TILDELOOSE] : re[t.TILDE];
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("tilde", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0 <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          ret = `>=${M}.${m}.0 <${M}.${+m + 1}.0-0`;
        } else if (pr) {
          debug("replaceTilde pr", pr);
          ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
        } else {
          ret = `>=${M}.${m}.${p} <${M}.${+m + 1}.0-0`;
        }
        debug("tilde return", ret);
        return ret;
      });
    };
    var replaceCarets = (comp, options) => {
      return comp.trim().split(/\s+/).map((c) => replaceCaret(c, options)).join(" ");
    };
    var replaceCaret = (comp, options) => {
      debug("caret", comp, options);
      const r = options.loose ? re[t.CARETLOOSE] : re[t.CARET];
      const z = options.includePrerelease ? "-0" : "";
      return comp.replace(r, (_, M, m, p, pr) => {
        debug("caret", comp, _, M, m, p, pr);
        let ret;
        if (isX(M)) {
          ret = "";
        } else if (isX(m)) {
          ret = `>=${M}.0.0${z} <${+M + 1}.0.0-0`;
        } else if (isX(p)) {
          if (M === "0") {
            ret = `>=${M}.${m}.0${z} <${M}.${+m + 1}.0-0`;
          } else {
            ret = `>=${M}.${m}.0${z} <${+M + 1}.0.0-0`;
          }
        } else if (pr) {
          debug("replaceCaret pr", pr);
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}-${pr} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p}-${pr} <${+M + 1}.0.0-0`;
          }
        } else {
          debug("no pr");
          if (M === "0") {
            if (m === "0") {
              ret = `>=${M}.${m}.${p}${z} <${M}.${m}.${+p + 1}-0`;
            } else {
              ret = `>=${M}.${m}.${p}${z} <${M}.${+m + 1}.0-0`;
            }
          } else {
            ret = `>=${M}.${m}.${p} <${+M + 1}.0.0-0`;
          }
        }
        debug("caret return", ret);
        return ret;
      });
    };
    var replaceXRanges = (comp, options) => {
      debug("replaceXRanges", comp, options);
      return comp.split(/\s+/).map((c) => replaceXRange(c, options)).join(" ");
    };
    var replaceXRange = (comp, options) => {
      comp = comp.trim();
      const r = options.loose ? re[t.XRANGELOOSE] : re[t.XRANGE];
      return comp.replace(r, (ret, gtlt, M, m, p, pr) => {
        debug("xRange", comp, ret, gtlt, M, m, p, pr);
        const xM = isX(M);
        const xm = xM || isX(m);
        const xp = xm || isX(p);
        const anyX = xp;
        if (gtlt === "=" && anyX) {
          gtlt = "";
        }
        pr = options.includePrerelease ? "-0" : "";
        if (xM) {
          if (gtlt === ">" || gtlt === "<") {
            ret = "<0.0.0-0";
          } else {
            ret = "*";
          }
        } else if (gtlt && anyX) {
          if (xm) {
            m = 0;
          }
          p = 0;
          if (gtlt === ">") {
            gtlt = ">=";
            if (xm) {
              M = +M + 1;
              m = 0;
              p = 0;
            } else {
              m = +m + 1;
              p = 0;
            }
          } else if (gtlt === "<=") {
            gtlt = "<";
            if (xm) {
              M = +M + 1;
            } else {
              m = +m + 1;
            }
          }
          if (gtlt === "<") {
            pr = "-0";
          }
          ret = `${gtlt + M}.${m}.${p}${pr}`;
        } else if (xm) {
          ret = `>=${M}.0.0${pr} <${+M + 1}.0.0-0`;
        } else if (xp) {
          ret = `>=${M}.${m}.0${pr} <${M}.${+m + 1}.0-0`;
        }
        debug("xRange return", ret);
        return ret;
      });
    };
    var replaceStars = (comp, options) => {
      debug("replaceStars", comp, options);
      return comp.trim().replace(re[t.STAR], "");
    };
    var replaceGTE0 = (comp, options) => {
      debug("replaceGTE0", comp, options);
      return comp.trim().replace(re[options.includePrerelease ? t.GTE0PRE : t.GTE0], "");
    };
    var hyphenReplace = (incPr) => ($0, from, fM, fm, fp, fpr, fb, to, tM, tm, tp, tpr) => {
      if (isX(fM)) {
        from = "";
      } else if (isX(fm)) {
        from = `>=${fM}.0.0${incPr ? "-0" : ""}`;
      } else if (isX(fp)) {
        from = `>=${fM}.${fm}.0${incPr ? "-0" : ""}`;
      } else if (fpr) {
        from = `>=${from}`;
      } else {
        from = `>=${from}${incPr ? "-0" : ""}`;
      }
      if (isX(tM)) {
        to = "";
      } else if (isX(tm)) {
        to = `<${+tM + 1}.0.0-0`;
      } else if (isX(tp)) {
        to = `<${tM}.${+tm + 1}.0-0`;
      } else if (tpr) {
        to = `<=${tM}.${tm}.${tp}-${tpr}`;
      } else if (incPr) {
        to = `<${tM}.${tm}.${+tp + 1}-0`;
      } else {
        to = `<=${to}`;
      }
      return `${from} ${to}`.trim();
    };
    var testSet = (set, version, options) => {
      for (let i = 0; i < set.length; i++) {
        if (!set[i].test(version)) {
          return false;
        }
      }
      if (version.prerelease.length && !options.includePrerelease) {
        for (let i = 0; i < set.length; i++) {
          debug(set[i].semver);
          if (set[i].semver === Comparator.ANY) {
            continue;
          }
          if (set[i].semver.prerelease.length > 0) {
            const allowed = set[i].semver;
            if (allowed.major === version.major && allowed.minor === version.minor && allowed.patch === version.patch) {
              return true;
            }
          }
        }
        return false;
      }
      return true;
    };
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/classes/comparator.js
var require_comparator = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/classes/comparator.js"(exports2, module2) {
    "use strict";
    var ANY = Symbol("SemVer ANY");
    var Comparator = class _Comparator {
      static get ANY() {
        return ANY;
      }
      constructor(comp, options) {
        options = parseOptions(options);
        if (comp instanceof _Comparator) {
          if (comp.loose === !!options.loose) {
            return comp;
          } else {
            comp = comp.value;
          }
        }
        comp = comp.trim().split(/\s+/).join(" ");
        debug("comparator", comp, options);
        this.options = options;
        this.loose = !!options.loose;
        this.parse(comp);
        if (this.semver === ANY) {
          this.value = "";
        } else {
          this.value = this.operator + this.semver.version;
        }
        debug("comp", this);
      }
      parse(comp) {
        const r = this.options.loose ? re[t.COMPARATORLOOSE] : re[t.COMPARATOR];
        const m = comp.match(r);
        if (!m) {
          throw new TypeError(`Invalid comparator: ${comp}`);
        }
        this.operator = m[1] !== void 0 ? m[1] : "";
        if (this.operator === "=") {
          this.operator = "";
        }
        if (!m[2]) {
          this.semver = ANY;
        } else {
          this.semver = new SemVer(m[2], this.options.loose);
        }
      }
      toString() {
        return this.value;
      }
      test(version) {
        debug("Comparator.test", version, this.options.loose);
        if (this.semver === ANY || version === ANY) {
          return true;
        }
        if (typeof version === "string") {
          try {
            version = new SemVer(version, this.options);
          } catch (er) {
            return false;
          }
        }
        return cmp(version, this.operator, this.semver, this.options);
      }
      intersects(comp, options) {
        if (!(comp instanceof _Comparator)) {
          throw new TypeError("a Comparator is required");
        }
        if (this.operator === "") {
          if (this.value === "") {
            return true;
          }
          return new Range(comp.value, options).test(this.value);
        } else if (comp.operator === "") {
          if (comp.value === "") {
            return true;
          }
          return new Range(this.value, options).test(comp.semver);
        }
        options = parseOptions(options);
        if (options.includePrerelease && (this.value === "<0.0.0-0" || comp.value === "<0.0.0-0")) {
          return false;
        }
        if (!options.includePrerelease && (this.value.startsWith("<0.0.0") || comp.value.startsWith("<0.0.0"))) {
          return false;
        }
        if (this.operator.startsWith(">") && comp.operator.startsWith(">")) {
          return true;
        }
        if (this.operator.startsWith("<") && comp.operator.startsWith("<")) {
          return true;
        }
        if (this.semver.version === comp.semver.version && this.operator.includes("=") && comp.operator.includes("=")) {
          return true;
        }
        if (cmp(this.semver, "<", comp.semver, options) && this.operator.startsWith(">") && comp.operator.startsWith("<")) {
          return true;
        }
        if (cmp(this.semver, ">", comp.semver, options) && this.operator.startsWith("<") && comp.operator.startsWith(">")) {
          return true;
        }
        return false;
      }
    };
    module2.exports = Comparator;
    var parseOptions = require_parse_options();
    var { safeRe: re, t } = require_re();
    var cmp = require_cmp();
    var debug = require_debug();
    var SemVer = require_semver();
    var Range = require_range();
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/satisfies.js
var require_satisfies = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/functions/satisfies.js"(exports2, module2) {
    "use strict";
    var Range = require_range();
    var satisfies2 = (version, range, options) => {
      try {
        range = new Range(range, options);
      } catch (er) {
        return false;
      }
      return range.test(version);
    };
    module2.exports = satisfies2;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/to-comparators.js
var require_to_comparators = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/to-comparators.js"(exports2, module2) {
    "use strict";
    var Range = require_range();
    var toComparators = (range, options) => new Range(range, options).set.map((comp) => comp.map((c) => c.value).join(" ").trim().split(" "));
    module2.exports = toComparators;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/max-satisfying.js
var require_max_satisfying = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/max-satisfying.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var maxSatisfying = (versions, range, options) => {
      let max = null;
      let maxSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!max || maxSV.compare(v) === -1) {
            max = v;
            maxSV = new SemVer(max, options);
          }
        }
      });
      return max;
    };
    module2.exports = maxSatisfying;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/min-satisfying.js
var require_min_satisfying = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/min-satisfying.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var minSatisfying = (versions, range, options) => {
      let min = null;
      let minSV = null;
      let rangeObj = null;
      try {
        rangeObj = new Range(range, options);
      } catch (er) {
        return null;
      }
      versions.forEach((v) => {
        if (rangeObj.test(v)) {
          if (!min || minSV.compare(v) === 1) {
            min = v;
            minSV = new SemVer(min, options);
          }
        }
      });
      return min;
    };
    module2.exports = minSatisfying;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/min-version.js
var require_min_version = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/min-version.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var Range = require_range();
    var gt = require_gt();
    var minVersion = (range, loose) => {
      range = new Range(range, loose);
      let minver = new SemVer("0.0.0");
      if (range.test(minver)) {
        return minver;
      }
      minver = new SemVer("0.0.0-0");
      if (range.test(minver)) {
        return minver;
      }
      minver = null;
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let setMin = null;
        comparators.forEach((comparator) => {
          const compver = new SemVer(comparator.semver.version);
          switch (comparator.operator) {
            case ">":
              if (compver.prerelease.length === 0) {
                compver.patch++;
              } else {
                compver.prerelease.push(0);
              }
              compver.raw = compver.format();
            /* fallthrough */
            case "":
            case ">=":
              if (!setMin || gt(compver, setMin)) {
                setMin = compver;
              }
              break;
            case "<":
            case "<=":
              break;
            /* istanbul ignore next */
            default:
              throw new Error(`Unexpected operation: ${comparator.operator}`);
          }
        });
        if (setMin && (!minver || gt(minver, setMin))) {
          minver = setMin;
        }
      }
      if (minver && range.test(minver)) {
        return minver;
      }
      return null;
    };
    module2.exports = minVersion;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/valid.js
var require_valid2 = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/valid.js"(exports2, module2) {
    "use strict";
    var Range = require_range();
    var validRange = (range, options) => {
      try {
        return new Range(range, options).range || "*";
      } catch (er) {
        return null;
      }
    };
    module2.exports = validRange;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/outside.js
var require_outside = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/outside.js"(exports2, module2) {
    "use strict";
    var SemVer = require_semver();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var Range = require_range();
    var satisfies2 = require_satisfies();
    var gt = require_gt();
    var lt = require_lt();
    var lte = require_lte();
    var gte = require_gte();
    var outside = (version, range, hilo, options) => {
      version = new SemVer(version, options);
      range = new Range(range, options);
      let gtfn, ltefn, ltfn, comp, ecomp;
      switch (hilo) {
        case ">":
          gtfn = gt;
          ltefn = lte;
          ltfn = lt;
          comp = ">";
          ecomp = ">=";
          break;
        case "<":
          gtfn = lt;
          ltefn = gte;
          ltfn = gt;
          comp = "<";
          ecomp = "<=";
          break;
        default:
          throw new TypeError('Must provide a hilo val of "<" or ">"');
      }
      if (satisfies2(version, range, options)) {
        return false;
      }
      for (let i = 0; i < range.set.length; ++i) {
        const comparators = range.set[i];
        let high = null;
        let low = null;
        comparators.forEach((comparator) => {
          if (comparator.semver === ANY) {
            comparator = new Comparator(">=0.0.0");
          }
          high = high || comparator;
          low = low || comparator;
          if (gtfn(comparator.semver, high.semver, options)) {
            high = comparator;
          } else if (ltfn(comparator.semver, low.semver, options)) {
            low = comparator;
          }
        });
        if (high.operator === comp || high.operator === ecomp) {
          return false;
        }
        if ((!low.operator || low.operator === comp) && ltefn(version, low.semver)) {
          return false;
        } else if (low.operator === ecomp && ltfn(version, low.semver)) {
          return false;
        }
      }
      return true;
    };
    module2.exports = outside;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/gtr.js
var require_gtr = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/gtr.js"(exports2, module2) {
    "use strict";
    var outside = require_outside();
    var gtr = (version, range, options) => outside(version, range, ">", options);
    module2.exports = gtr;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/ltr.js
var require_ltr = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/ltr.js"(exports2, module2) {
    "use strict";
    var outside = require_outside();
    var ltr = (version, range, options) => outside(version, range, "<", options);
    module2.exports = ltr;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/intersects.js
var require_intersects = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/intersects.js"(exports2, module2) {
    "use strict";
    var Range = require_range();
    var intersects = (r1, r2, options) => {
      r1 = new Range(r1, options);
      r2 = new Range(r2, options);
      return r1.intersects(r2, options);
    };
    module2.exports = intersects;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/simplify.js
var require_simplify = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/simplify.js"(exports2, module2) {
    "use strict";
    var satisfies2 = require_satisfies();
    var compare = require_compare();
    module2.exports = (versions, range, options) => {
      const set = [];
      let first = null;
      let prev = null;
      const v = versions.sort((a, b) => compare(a, b, options));
      for (const version of v) {
        const included = satisfies2(version, range, options);
        if (included) {
          prev = version;
          if (!first) {
            first = version;
          }
        } else {
          if (prev) {
            set.push([first, prev]);
          }
          prev = null;
          first = null;
        }
      }
      if (first) {
        set.push([first, null]);
      }
      const ranges = [];
      for (const [min, max] of set) {
        if (min === max) {
          ranges.push(min);
        } else if (!max && min === v[0]) {
          ranges.push("*");
        } else if (!max) {
          ranges.push(`>=${min}`);
        } else if (min === v[0]) {
          ranges.push(`<=${max}`);
        } else {
          ranges.push(`${min} - ${max}`);
        }
      }
      const simplified = ranges.join(" || ");
      const original = typeof range.raw === "string" ? range.raw : String(range);
      return simplified.length < original.length ? simplified : range;
    };
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/subset.js
var require_subset = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/ranges/subset.js"(exports2, module2) {
    "use strict";
    var Range = require_range();
    var Comparator = require_comparator();
    var { ANY } = Comparator;
    var satisfies2 = require_satisfies();
    var compare = require_compare();
    var subset = (sub, dom, options = {}) => {
      if (sub === dom) {
        return true;
      }
      sub = new Range(sub, options);
      dom = new Range(dom, options);
      let sawNonNull = false;
      OUTER: for (const simpleSub of sub.set) {
        for (const simpleDom of dom.set) {
          const isSub = simpleSubset(simpleSub, simpleDom, options);
          sawNonNull = sawNonNull || isSub !== null;
          if (isSub) {
            continue OUTER;
          }
        }
        if (sawNonNull) {
          return false;
        }
      }
      return true;
    };
    var minimumVersionWithPreRelease = [new Comparator(">=0.0.0-0")];
    var minimumVersion = [new Comparator(">=0.0.0")];
    var simpleSubset = (sub, dom, options) => {
      if (sub === dom) {
        return true;
      }
      if (sub.length === 1 && sub[0].semver === ANY) {
        if (dom.length === 1 && dom[0].semver === ANY) {
          return true;
        } else if (options.includePrerelease) {
          sub = minimumVersionWithPreRelease;
        } else {
          sub = minimumVersion;
        }
      }
      if (dom.length === 1 && dom[0].semver === ANY) {
        if (options.includePrerelease) {
          return true;
        } else {
          dom = minimumVersion;
        }
      }
      const eqSet = /* @__PURE__ */ new Set();
      let gt, lt;
      for (const c of sub) {
        if (c.operator === ">" || c.operator === ">=") {
          gt = higherGT(gt, c, options);
        } else if (c.operator === "<" || c.operator === "<=") {
          lt = lowerLT(lt, c, options);
        } else {
          eqSet.add(c.semver);
        }
      }
      if (eqSet.size > 1) {
        return null;
      }
      let gtltComp;
      if (gt && lt) {
        gtltComp = compare(gt.semver, lt.semver, options);
        if (gtltComp > 0) {
          return null;
        } else if (gtltComp === 0 && (gt.operator !== ">=" || lt.operator !== "<=")) {
          return null;
        }
      }
      for (const eq of eqSet) {
        if (gt && !satisfies2(eq, String(gt), options)) {
          return null;
        }
        if (lt && !satisfies2(eq, String(lt), options)) {
          return null;
        }
        for (const c of dom) {
          if (!satisfies2(eq, String(c), options)) {
            return false;
          }
        }
        return true;
      }
      let higher, lower;
      let hasDomLT, hasDomGT;
      let needDomLTPre = lt && !options.includePrerelease && lt.semver.prerelease.length ? lt.semver : false;
      let needDomGTPre = gt && !options.includePrerelease && gt.semver.prerelease.length ? gt.semver : false;
      if (needDomLTPre && needDomLTPre.prerelease.length === 1 && lt.operator === "<" && needDomLTPre.prerelease[0] === 0) {
        needDomLTPre = false;
      }
      for (const c of dom) {
        hasDomGT = hasDomGT || c.operator === ">" || c.operator === ">=";
        hasDomLT = hasDomLT || c.operator === "<" || c.operator === "<=";
        if (gt) {
          if (needDomGTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomGTPre.major && c.semver.minor === needDomGTPre.minor && c.semver.patch === needDomGTPre.patch) {
              needDomGTPre = false;
            }
          }
          if (c.operator === ">" || c.operator === ">=") {
            higher = higherGT(gt, c, options);
            if (higher === c && higher !== gt) {
              return false;
            }
          } else if (gt.operator === ">=" && !satisfies2(gt.semver, String(c), options)) {
            return false;
          }
        }
        if (lt) {
          if (needDomLTPre) {
            if (c.semver.prerelease && c.semver.prerelease.length && c.semver.major === needDomLTPre.major && c.semver.minor === needDomLTPre.minor && c.semver.patch === needDomLTPre.patch) {
              needDomLTPre = false;
            }
          }
          if (c.operator === "<" || c.operator === "<=") {
            lower = lowerLT(lt, c, options);
            if (lower === c && lower !== lt) {
              return false;
            }
          } else if (lt.operator === "<=" && !satisfies2(lt.semver, String(c), options)) {
            return false;
          }
        }
        if (!c.operator && (lt || gt) && gtltComp !== 0) {
          return false;
        }
      }
      if (gt && hasDomLT && !lt && gtltComp !== 0) {
        return false;
      }
      if (lt && hasDomGT && !gt && gtltComp !== 0) {
        return false;
      }
      if (needDomGTPre || needDomLTPre) {
        return false;
      }
      return true;
    };
    var higherGT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp > 0 ? a : comp < 0 ? b : b.operator === ">" && a.operator === ">=" ? b : a;
    };
    var lowerLT = (a, b, options) => {
      if (!a) {
        return b;
      }
      const comp = compare(a.semver, b.semver, options);
      return comp < 0 ? a : comp > 0 ? b : b.operator === "<" && a.operator === "<=" ? b : a;
    };
    module2.exports = subset;
  }
});

// node_modules/.pnpm/semver@7.7.4/node_modules/semver/index.js
var require_semver2 = __commonJS({
  "node_modules/.pnpm/semver@7.7.4/node_modules/semver/index.js"(exports2, module2) {
    "use strict";
    var internalRe = require_re();
    var constants = require_constants();
    var SemVer = require_semver();
    var identifiers = require_identifiers();
    var parse = require_parse();
    var valid2 = require_valid();
    var clean = require_clean();
    var inc = require_inc();
    var diff = require_diff();
    var major = require_major();
    var minor = require_minor();
    var patch = require_patch();
    var prerelease = require_prerelease();
    var compare = require_compare();
    var rcompare = require_rcompare();
    var compareLoose = require_compare_loose();
    var compareBuild = require_compare_build();
    var sort = require_sort();
    var rsort = require_rsort();
    var gt = require_gt();
    var lt = require_lt();
    var eq = require_eq();
    var neq = require_neq();
    var gte = require_gte();
    var lte = require_lte();
    var cmp = require_cmp();
    var coerce = require_coerce();
    var Comparator = require_comparator();
    var Range = require_range();
    var satisfies2 = require_satisfies();
    var toComparators = require_to_comparators();
    var maxSatisfying = require_max_satisfying();
    var minSatisfying = require_min_satisfying();
    var minVersion = require_min_version();
    var validRange = require_valid2();
    var outside = require_outside();
    var gtr = require_gtr();
    var ltr = require_ltr();
    var intersects = require_intersects();
    var simplifyRange = require_simplify();
    var subset = require_subset();
    module2.exports = {
      parse,
      valid: valid2,
      clean,
      inc,
      diff,
      major,
      minor,
      patch,
      prerelease,
      compare,
      rcompare,
      compareLoose,
      compareBuild,
      sort,
      rsort,
      gt,
      lt,
      eq,
      neq,
      gte,
      lte,
      cmp,
      coerce,
      Comparator,
      Range,
      satisfies: satisfies2,
      toComparators,
      maxSatisfying,
      minSatisfying,
      minVersion,
      validRange,
      outside,
      gtr,
      ltr,
      intersects,
      simplifyRange,
      subset,
      SemVer,
      re: internalRe.re,
      src: internalRe.src,
      tokens: internalRe.t,
      SEMVER_SPEC_VERSION: constants.SEMVER_SPEC_VERSION,
      RELEASE_TYPES: constants.RELEASE_TYPES,
      compareIdentifiers: identifiers.compareIdentifiers,
      rcompareIdentifiers: identifiers.rcompareIdentifiers
    };
  }
});

// packages/plugin/src/registry.ts
var registry_exports = {};
__export(registry_exports, {
  PluginRegistry: () => PluginRegistry,
  createPluginContributionIndex: () => createPluginContributionIndex,
  createPluginScopedStorage: () => createPluginScopedStorage,
  parsePluginRegistrySnapshot: () => parsePluginRegistrySnapshot,
  serializePluginRegistry: () => serializePluginRegistry,
  validatePluginCompatibility: () => validatePluginCompatibility
});
module.exports = __toCommonJS(registry_exports);
var import_semver = __toESM(require_semver2(), 1);

// packages/plugin/src/settings-schema.ts
var PluginSettingsError = class extends Error {
  constructor(code) {
    super(`Settings operation failed: ${code}`);
    this.code = code;
    this.name = "PluginSettingsError";
  }
};
function settingsRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function settingsKeys(value, required, optional = []) {
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function invalid() {
  throw new PluginSettingsError("invalid-input");
}
function validKey(value) {
  return /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(value) && !value.split(".").some((part) => ["__proto__", "constructor", "prototype"].includes(part));
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function scalar(value) {
  return typeof value === "boolean" || finite(value) || typeof value === "string" && value.length <= 256;
}
function copyPluginSettingsSchema(value) {
  if (!settingsRecord(value)) invalid();
  const items = Object.entries(value);
  if (!items.length || items.length > 64) invalid();
  const schema = {};
  for (const [key, field] of items) {
    if (!validKey(key) || !settingsRecord(field)) invalid();
    if (field.type === "boolean" && settingsKeys(field, ["type"]))
      schema[key] = Object.freeze({ type: "boolean" });
    else if (field.type === "enum" && settingsKeys(field, ["type", "options"]) && Array.isArray(field.options) && field.options.length > 0 && field.options.length <= 32 && field.options.every((item) => typeof item !== "boolean" && scalar(item)) && new Set(field.options).size === field.options.length) {
      schema[key] = Object.freeze({ type: "enum", options: Object.freeze([...field.options]) });
    } else if (field.type === "number" && settingsKeys(field, ["type", "minimum", "maximum"], ["step", "allowZero"]) && finite(field.minimum) && finite(field.maximum) && field.minimum <= field.maximum && (!Object.hasOwn(field, "step") || finite(field.step) && field.step > 0) && (!Object.hasOwn(field, "allowZero") || typeof field.allowZero === "boolean")) {
      schema[key] = Object.freeze({
        type: "number",
        minimum: field.minimum,
        maximum: field.maximum,
        ...field.step !== void 0 ? { step: field.step } : {},
        ...field.allowZero !== void 0 ? { allowZero: field.allowZero } : {}
      });
    } else invalid();
  }
  return Object.freeze(schema);
}
function copyPluginSettingsValues(value, schema, partial = false) {
  if (!settingsRecord(value)) invalid();
  const entries = Object.entries(value);
  if (!partial && entries.length === 0 || entries.length > 64 || partial && !entries.length)
    invalid();
  if (schema && !partial && Object.keys(schema).length !== entries.length) invalid();
  const copied = {};
  for (const [key, item] of entries) {
    if (!validKey(key) || !scalar(item)) invalid();
    if (schema) {
      const field = Object.hasOwn(schema, key) ? schema[key] : void 0;
      if (!field) invalid();
      if (field.type === "boolean" && typeof item !== "boolean") invalid();
      if (field.type === "enum" && !field.options.includes(item)) invalid();
      if (field.type === "number") {
        if (!finite(item)) invalid();
        if (!(field.allowZero && item === 0)) {
          if (item < field.minimum || item > field.maximum) invalid();
          if (field.step !== void 0) {
            const multiple = (item - field.minimum) / field.step;
            if (!Number.isFinite(multiple) || Math.abs(multiple - Math.round(multiple)) > 1e-7)
              invalid();
          }
        }
      }
    }
    copied[key] = item;
  }
  return Object.freeze(copied);
}
function copyPluginSettingsDescriptor(value) {
  if (!settingsRecord(value) || !settingsKeys(value, ["schema", "defaults"])) invalid();
  const schema = copyPluginSettingsSchema(value.schema);
  return Object.freeze({ schema, defaults: copyPluginSettingsValues(value.defaults, schema) });
}

// packages/plugin/src/manifest.ts
var PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z][a-z0-9]*)*$/;
var VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
var ACTION_ID_PATTERN = /^[a-z][A-Za-z0-9]*(?:[.:][a-z][A-Za-z0-9]*)+$/;
var KNOWN_PERMISSIONS = /* @__PURE__ */ new Set([
  "document:read",
  "document:write",
  "view:read",
  "view:write",
  "file:read",
  "file:write",
  "file:delete",
  "app:control",
  "app:updates",
  "app:plugins",
  "workspace:read",
  "settings:write",
  "app:keymap",
  "images:import",
  "document:output",
  "network:access"
]);
var KNOWN_HOSTS = /* @__PURE__ */ new Set(["worker", "sidecar", "dom"]);
var KNOWN_UI_SLOTS = /* @__PURE__ */ new Set([
  "menu-page",
  "sidebar-panel",
  "bottom-panel",
  "document-toolbar",
  "statusbar",
  "modal",
  "context-menu"
]);
var KNOWN_UI_SCOPES = /* @__PURE__ */ new Set(["app", "document"]);
var KNOWN_IMPORTER_TARGETS = /* @__PURE__ */ new Set([
  "markdown",
  "custom-view"
]);
function parsePluginManifest(value) {
  const result = validatePluginManifest(value);
  if (!result.ok || !result.manifest) {
    throw new Error(
      `Invalid plugin manifest:
${result.errors.map((error) => `- ${error.path}: ${error.message}`).join("\n")}`
    );
  }
  return result.manifest;
}
function validatePluginManifest(value) {
  const errors = [];
  if (!isRecord(value)) {
    return invalid2([{ path: "$", message: "Manifest must be an object" }]);
  }
  const id = readRequiredString(value, "id", "$.id", errors);
  const name = readRequiredString(value, "name", "$.name", errors);
  const version = readRequiredString(value, "version", "$.version", errors);
  const host = readOptionalHost(value.host, errors);
  const main = readOptionalString(value, "main", "$.main", errors);
  const resources = readOptionalStringArray(value.resources, "$.resources", errors);
  const icon = readOptionalString(value, "icon", "$.icon", errors);
  if (icon !== void 0 && (!isPluginIconPath(icon) || !resources?.includes(icon))) {
    errors.push({
      path: "$.icon",
      message: "Icon must be a package-relative PNG path explicitly listed in resources"
    });
  }
  const networkOrigins = readOptionalStringArray(value.networkOrigins, "$.networkOrigins", errors);
  const description = readOptionalString(value, "description", "$.description", errors);
  const engines = readOptionalEngines(value.engines, errors);
  const permissions = readPermissions(value.permissions, errors, "$.permissions");
  if (permissions.includes("document:output") && !permissions.includes("document:read"))
    errors.push({ path: "$.permissions", message: "Document output requires document:read" });
  let settings;
  if (value.settings !== void 0) {
    try {
      settings = copyPluginSettingsDescriptor(value.settings);
    } catch {
      errors.push({
        path: "$.settings",
        message: "Settings must define a bounded schema and valid defaults"
      });
    }
  }
  const contributes = readContributions(value.contributes, errors);
  if (host === "dom") validateDomProfile(value, main, contributes, errors);
  if (contributes?.documentRenderers?.length && !permissions.includes("document:read"))
    errors.push({ path: "$.permissions", message: "Document renderers require document:read" });
  validateCommandPermissionScope(contributes?.commands, permissions, errors);
  validateContributionIntegrity(contributes, errors);
  for (const [i, handler] of (contributes?.pasteHandlers ?? []).entries()) {
    if (!permissions.includes("images:import") || !contributes?.commands?.some((c) => c.action === handler.command))
      errors.push({
        path: `$.contributes.pasteHandlers[${i}]`,
        message: "Image paste requires images:import and an owned contributed command"
      });
  }
  if ((contributes?.pasteHandlers?.length ?? 0) > 1)
    errors.push({
      path: "$.contributes.pasteHandlers",
      message: "Only one image paste handler is allowed"
    });
  validateNetworkOrigins(networkOrigins, permissions, errors);
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: "$.id", message: "Plugin id must be kebab/dot case" });
  }
  if (version && !VERSION_PATTERN.test(version)) {
    errors.push({ path: "$.version", message: "Version must be semver-like" });
  }
  if (errors.length > 0 || !id || !name || !version) {
    return invalid2(errors);
  }
  return {
    ok: true,
    manifest: Object.freeze({
      id,
      name,
      version,
      ...host ? { host } : {},
      ...main ? { main } : {},
      ...resources ? { resources: Object.freeze(resources) } : {},
      ...icon ? { icon } : {},
      ...networkOrigins ? { networkOrigins: Object.freeze(networkOrigins) } : {},
      ...description ? { description } : {},
      ...engines ? { engines } : {},
      ...permissions.length > 0 ? { permissions: Object.freeze(permissions) } : {},
      ...settings ? { settings } : {},
      ...contributes ? { contributes } : {}
    }),
    errors: Object.freeze([])
  };
}
function isPluginIconPath(path) {
  return /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/i.test(path);
}
function validateDomProfile(value, main, contributes, errors) {
  const path = main?.replace(/^\.\//, "");
  if (!path || path.length > 1024 || /[\\\u0000-\u001f\u007f:%?#]/u.test(path) || path.split("/").some((part) => !part || part === "." || part === ".."))
    errors.push({ path: "$.main", message: "DOM plugin main must be a package-relative path" });
  if (!Array.isArray(value.permissions) || value.permissions.length !== 1 || value.permissions[0] !== "document:read")
    errors.push({ path: "$.permissions", message: "DOM plugins permit only document:read" });
  if (value.networkOrigins !== void 0)
    errors.push({ path: "$.networkOrigins", message: "DOM plugins cannot declare network origins" });
  if (value.settings !== void 0)
    errors.push({ path: "$.settings", message: "DOM plugins cannot declare persistent settings" });
  if (!contributes?.documentRenderers?.length)
    errors.push({
      path: "$.contributes.documentRenderers",
      message: "DOM plugins require at least one document renderer"
    });
  if (isRecord(value.contributes)) {
    for (const key of Object.keys(value.contributes)) {
      if (key !== "documentRenderers")
        errors.push({
          path: `$.contributes.${key}`,
          message: "DOM plugins may contribute only documentRenderers"
        });
    }
  }
}
function validateNetworkOrigins(origins, permissions, errors) {
  if (!permissions.includes("network:access")) {
    return;
  }
  if (!origins) {
    return;
  }
  for (const [index, value] of origins.entries()) {
    try {
      const url = new URL(value);
      if (url.origin !== value || !["http:", "https:"].includes(url.protocol)) {
        throw new Error("invalid origin");
      }
    } catch {
      errors.push({
        path: `$.networkOrigins[${index}]`,
        message: "Network origin must be an exact HTTP(S) origin"
      });
    }
  }
}
function readOptionalHost(value, errors) {
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "string" || !KNOWN_HOSTS.has(value)) {
    errors.push({
      path: "$.host",
      message: `Unknown plugin host: ${String(value)}`
    });
    return void 0;
  }
  return value;
}
function readContributions(value, errors) {
  if (value === void 0) {
    return void 0;
  }
  if (!isRecord(value)) {
    errors.push({ path: "$.contributes", message: "Contributes must be an object" });
    return void 0;
  }
  const commands = readArray(
    value.commands,
    "$.contributes.commands",
    readCommandContribution,
    errors
  );
  const pasteHandlers = readArray(
    value.pasteHandlers,
    "$.contributes.pasteHandlers",
    readPasteHandler,
    errors
  );
  const keymaps = readArray(value.keymaps, "$.contributes.keymaps", readKeymapContribution, errors);
  const renderers = readArray(
    value.renderers,
    "$.contributes.renderers",
    readRendererContribution,
    errors
  );
  const documentRenderers = readArray(
    value.documentRenderers,
    "$.contributes.documentRenderers",
    readDocumentRendererContribution,
    errors
  );
  if (documentRenderers && documentRenderers.length > 16)
    errors.push({
      path: "$.contributes.documentRenderers",
      message: "At most 16 document renderers"
    });
  if (documentRenderers && new Set(documentRenderers.map((r) => r.id)).size !== documentRenderers.length)
    errors.push({
      path: "$.contributes.documentRenderers",
      message: "Duplicate document renderer id"
    });
  const markdownSyntax = readArray(
    value.markdownSyntax,
    "$.contributes.markdownSyntax",
    readMarkdownSyntaxContribution,
    errors
  );
  const ui = readArray(value.ui, "$.contributes.ui", readUiContribution, errors);
  const importers = readArray(
    value.importers,
    "$.contributes.importers",
    readImporterContribution,
    errors
  );
  const documentTypes = readArray(
    value.documentTypes,
    "$.contributes.documentTypes",
    readDocumentTypeContribution,
    errors
  );
  return Object.freeze({
    ...commands ? { commands: Object.freeze(commands) } : {},
    ...pasteHandlers ? { pasteHandlers: Object.freeze(pasteHandlers) } : {},
    ...keymaps ? { keymaps: Object.freeze(keymaps) } : {},
    ...renderers ? { renderers: Object.freeze(renderers) } : {},
    ...documentRenderers ? { documentRenderers: Object.freeze(documentRenderers) } : {},
    ...markdownSyntax ? { markdownSyntax: Object.freeze(markdownSyntax) } : {},
    ...ui ? { ui: Object.freeze(ui) } : {},
    ...importers ? { importers: Object.freeze(importers) } : {},
    ...documentTypes ? { documentTypes: Object.freeze(documentTypes) } : {}
  });
}
function readOptionalEngines(value, errors) {
  if (value === void 0) {
    return void 0;
  }
  if (!isRecord(value)) {
    errors.push({ path: "$.engines", message: "Engines must be an object" });
    return void 0;
  }
  const milkup = readOptionalString(value, "milkup", "$.engines.milkup", errors);
  const pluginSdk = readOptionalString(value, "pluginSdk", "$.engines.pluginSdk", errors);
  return Object.freeze({
    ...milkup ? { milkup } : {},
    ...pluginSdk ? { pluginSdk } : {}
  });
}
function readCommandContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "Command contribution must be an object" });
    return void 0;
  }
  const id = readRequiredString(value, "id", `${path}.id`, errors);
  const title = readRequiredString(value, "title", `${path}.title`, errors);
  const action = readRequiredString(value, "action", `${path}.action`, errors);
  const category = readOptionalString(value, "category", `${path}.category`, errors);
  const permissions = Object.prototype.hasOwnProperty.call(value, "permissions") ? readPermissions(value.permissions, errors, `${path}.permissions`) : void 0;
  const inputSchema = readOptionalInputSchema(value.inputSchema, `${path}.inputSchema`, errors);
  if (id && !ACTION_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: "Command id must be an action-style id" });
  }
  if (action && !ACTION_ID_PATTERN.test(action)) {
    errors.push({ path: `${path}.action`, message: "Command action must be an action-style id" });
  }
  if (!id || !title || !action) {
    return void 0;
  }
  return Object.freeze({
    id,
    title,
    action,
    ...category ? { category } : {},
    ...permissions ? { permissions: Object.freeze(permissions) } : {},
    ...inputSchema ? { inputSchema } : {}
  });
}
function readOptionalInputSchema(value, path, errors) {
  if (value === void 0) {
    return void 0;
  }
  if (!isRecord(value)) {
    errors.push({ path, message: "Input schema must be an object schema" });
    return void 0;
  }
  if (value.type !== "object") {
    errors.push({ path: `${path}.type`, message: "Input schema type must be object" });
  }
  const properties = readOptionalInputSchemaProperties(
    value.properties,
    `${path}.properties`,
    errors
  );
  return Object.freeze({
    type: "object",
    ...properties ? { properties } : {}
  });
}
function readOptionalInputSchemaProperties(value, path, errors) {
  if (value === void 0) {
    return void 0;
  }
  if (!isRecord(value)) {
    errors.push({ path, message: "Input schema properties must be an object" });
    return void 0;
  }
  const properties = {};
  for (const [name, field] of Object.entries(value)) {
    const propertyPath = `${path}.${name}`;
    if (!isRecord(field)) {
      errors.push({ path: propertyPath, message: "Input schema property must be an object" });
      continue;
    }
    const type = field.type;
    if (!isInputFieldType(type)) {
      errors.push({
        path: `${propertyPath}.type`,
        message: `Invalid input schema field type: ${String(type)}`
      });
      continue;
    }
    const required = readOptionalBoolean(field, "required", `${propertyPath}.required`, errors);
    const description = readOptionalString(
      field,
      "description",
      `${propertyPath}.description`,
      errors
    );
    properties[name] = Object.freeze({
      type,
      ...required !== void 0 ? { required } : {},
      ...description ? { description } : {}
    });
  }
  return Object.freeze(properties);
}
function isInputFieldType(value) {
  return value === "string" || value === "number" || value === "boolean";
}
function readKeymapContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "Keymap contribution must be an object" });
    return void 0;
  }
  const command = readRequiredString(value, "command", `${path}.command`, errors);
  const key = readRequiredString(value, "key", `${path}.key`, errors);
  const when = readOptionalString(value, "when", `${path}.when`, errors);
  if (command && !ACTION_ID_PATTERN.test(command)) {
    errors.push({ path: `${path}.command`, message: "Keymap command must be an action-style id" });
  }
  if (!command || !key) {
    return void 0;
  }
  return Object.freeze({
    command,
    key,
    ...when ? { when } : {}
  });
}
function readRendererContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "Renderer contribution must be an object" });
    return void 0;
  }
  const id = readRequiredString(value, "id", `${path}.id`, errors);
  const nodeType = readRequiredString(value, "nodeType", `${path}.nodeType`, errors);
  const module2 = readRequiredString(value, "module", `${path}.module`, errors);
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: "Renderer id must be kebab/dot case" });
  }
  if (!id || !nodeType || !module2) {
    return void 0;
  }
  return Object.freeze({ id, nodeType, module: module2 });
}
function readMarkdownSyntaxContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "Markdown syntax contribution must be an object" });
    return void 0;
  }
  const id = readRequiredString(value, "id", `${path}.id`, errors);
  const nodeType = readRequiredString(value, "nodeType", `${path}.nodeType`, errors);
  const pattern = readRequiredString(value, "pattern", `${path}.pattern`, errors);
  const flags = readOptionalString(value, "flags", `${path}.flags`, errors);
  const block = readOptionalBoolean(value, "block", `${path}.block`, errors);
  const inline = readOptionalBoolean(value, "inline", `${path}.inline`, errors);
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: "Markdown syntax id must be kebab/dot case" });
  }
  if (!block && !inline) {
    errors.push({ path, message: "Markdown syntax contribution must enable block or inline" });
  }
  if (nodeType && !/^[a-z][A-Za-z0-9.-]*$/.test(nodeType)) {
    errors.push({ path: `${path}.nodeType`, message: "Markdown node type must be identifier-like" });
  }
  if (pattern) {
    validateMarkdownSyntaxPattern(pattern, flags, path, errors);
  }
  if (!id || !nodeType || !pattern) {
    return void 0;
  }
  return Object.freeze({
    id,
    nodeType,
    pattern,
    ...flags ? { flags } : {},
    ...block !== void 0 ? { block } : {},
    ...inline !== void 0 ? { inline } : {}
  });
}
function validateMarkdownSyntaxPattern(pattern, flags, path, errors) {
  if (pattern.length > 256) {
    errors.push({ path: `${path}.pattern`, message: "Markdown syntax pattern is too long" });
    return;
  }
  if (/\(\?[<!=]|\\[1-9]|\([^)]*(?:\*|\+|\{\d+,?\d*\})[^)]*\)(?:\*|\+|\{)/.test(pattern)) {
    errors.push({
      path: `${path}.pattern`,
      message: "Markdown syntax pattern uses unsafe features"
    });
    return;
  }
  if (flags && !/^[imu]*$/.test(flags)) {
    errors.push({ path: `${path}.flags`, message: "Markdown syntax flags may only use i, m, or u" });
    return;
  }
  try {
    new RegExp(pattern, flags);
  } catch {
    errors.push({ path: `${path}.pattern`, message: "Markdown syntax pattern is invalid" });
  }
}
function readUiContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "UI contribution must be an object" });
    return void 0;
  }
  const id = readRequiredString(value, "id", `${path}.id`, errors);
  const slot = readRequiredString(value, "slot", `${path}.slot`, errors);
  const title = readRequiredString(value, "title", `${path}.title`, errors);
  const scope = readOptionalString(value, "scope", `${path}.scope`, errors);
  const viewportUpdates = readOptionalBoolean(
    value,
    "viewportUpdates",
    `${path}.viewportUpdates`,
    errors
  );
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: "UI contribution id must be kebab/dot case" });
  }
  if (slot && !KNOWN_UI_SLOTS.has(slot)) {
    errors.push({ path: `${path}.slot`, message: `Unknown UI slot: ${slot}` });
  }
  if (scope && !KNOWN_UI_SCOPES.has(scope)) {
    errors.push({ path: `${path}.scope`, message: `Unknown UI scope: ${scope}` });
  }
  if (!id || !slot || !title || !KNOWN_UI_SLOTS.has(slot)) {
    return void 0;
  }
  const contribution = {
    id,
    slot,
    title
  };
  if (scope) {
    contribution.scope = scope;
  }
  if (viewportUpdates !== void 0) {
    contribution.viewportUpdates = viewportUpdates;
  }
  return Object.freeze(contribution);
}
function readImporterContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "Importer contribution must be an object" });
    return void 0;
  }
  const id = readRequiredString(value, "id", `${path}.id`, errors);
  const title = readRequiredString(value, "title", `${path}.title`, errors);
  const extensions = readStringArray(value.extensions, `${path}.extensions`, errors);
  const mimeTypes = readOptionalStringArray(value.mimeTypes, `${path}.mimeTypes`, errors);
  const target = readRequiredString(value, "target", `${path}.target`, errors);
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({ path: `${path}.id`, message: "Importer id must be kebab/dot case" });
  }
  if (target && !KNOWN_IMPORTER_TARGETS.has(target)) {
    errors.push({ path: `${path}.target`, message: `Unknown importer target: ${target}` });
  }
  if (!id || !title || !extensions || !target) {
    return void 0;
  }
  return Object.freeze({
    id,
    title,
    extensions: Object.freeze(extensions),
    ...mimeTypes ? { mimeTypes: Object.freeze(mimeTypes) } : {},
    target
  });
}
function readDocumentTypeContribution(value, path, errors) {
  if (!isRecord(value)) {
    errors.push({ path, message: "Document type contribution must be an object" });
    return void 0;
  }
  const id = readRequiredString(value, "id", `${path}.id`, errors);
  const title = readRequiredString(value, "title", `${path}.title`, errors);
  const extensions = readStringArray(value.extensions, `${path}.extensions`, errors);
  const readonly = readOptionalBoolean(value, "readonly", `${path}.readonly`, errors);
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    errors.push({
      path: `${path}.id`,
      message: "Document type id must be kebab/dot case"
    });
  }
  if (!id || !title || !extensions) {
    return void 0;
  }
  return Object.freeze({
    id,
    title,
    extensions: Object.freeze(extensions),
    ...readonly !== void 0 ? { readonly } : {}
  });
}
function readPermissions(value, errors, path) {
  if (value === void 0) {
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push({ path, message: "Permissions must be an array" });
    return [];
  }
  const permissions = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || !KNOWN_PERMISSIONS.has(item)) {
      errors.push({
        path: `${path}[${index}]`,
        message: `Unknown plugin permission: ${String(item)}`
      });
      continue;
    }
    permissions.push(item);
  }
  return permissions;
}
function validateCommandPermissionScope(commands, manifestPermissions, errors) {
  if (!commands) {
    return;
  }
  for (const [commandIndex, command] of commands.entries()) {
    if (!command.permissions) {
      continue;
    }
    for (const [permissionIndex, permission] of command.permissions.entries()) {
      if (!manifestPermissions.includes(permission)) {
        errors.push({
          path: `$.contributes.commands[${commandIndex}].permissions[${permissionIndex}]`,
          message: `Command permission must be declared in top-level permissions: ${permission}`
        });
      }
    }
  }
}
function validateContributionIntegrity(contributes, errors) {
  validateUniqueValues(
    contributes?.commands,
    "$.contributes.commands",
    "id",
    "Duplicate command id",
    errors
  );
  validateUniqueValues(
    contributes?.commands,
    "$.contributes.commands",
    "action",
    "Duplicate command action",
    errors
  );
  validateKnownKeymapCommands(contributes?.keymaps, contributes?.commands, errors);
  validateUniqueValues(
    contributes?.renderers,
    "$.contributes.renderers",
    "id",
    "Duplicate renderer id",
    errors
  );
  validateUniqueValues(
    contributes?.markdownSyntax,
    "$.contributes.markdownSyntax",
    "id",
    "Duplicate markdown syntax id",
    errors
  );
  validateUniqueValues(contributes?.ui, "$.contributes.ui", "id", "Duplicate UI id", errors);
  validateUniqueValues(
    contributes?.importers,
    "$.contributes.importers",
    "id",
    "Duplicate importer id",
    errors
  );
  validateUniqueValues(
    contributes?.documentTypes,
    "$.contributes.documentTypes",
    "id",
    "Duplicate document type id",
    errors
  );
  validateRenderableContributionIds(contributes, errors);
}
function validateRenderableContributionIds(contributes, errors) {
  const groups = [
    ["renderers", contributes?.renderers],
    ["ui", contributes?.ui],
    ["importers", contributes?.importers],
    ["documentTypes", contributes?.documentTypes]
  ];
  const seen = /* @__PURE__ */ new Map();
  for (const [group, items] of groups) {
    for (const [index, item] of (items ?? []).entries()) {
      const previous = seen.get(item.id);
      if (previous) {
        errors.push({
          path: `$.contributes.${group}[${index}].id`,
          message: `Renderable contribution id conflicts with ${previous}: ${item.id}`
        });
      } else {
        seen.set(item.id, group);
      }
    }
  }
}
function validateUniqueValues(items, path, key, message, errors) {
  if (!items) {
    return;
  }
  const seen = /* @__PURE__ */ new Set();
  for (const [index, item] of items.entries()) {
    const value = item[key];
    if (seen.has(value)) {
      errors.push({
        path: `${path}[${index}].${String(key)}`,
        message: `${message}: ${value}`
      });
      continue;
    }
    seen.add(value);
  }
}
function validateKnownKeymapCommands(keymaps, commands, errors) {
  if (!keymaps) {
    return;
  }
  const commandActions = new Set((commands ?? []).map((command) => command.action));
  for (const [index, keymap] of keymaps.entries()) {
    if (!commandActions.has(keymap.command)) {
      errors.push({
        path: `$.contributes.keymaps[${index}].command`,
        message: `Keymap command must reference a contributed command action: ${keymap.command}`
      });
    }
  }
}
function readArray(value, path, readItem, errors) {
  if (value === void 0) {
    return void 0;
  }
  if (!Array.isArray(value)) {
    errors.push({ path, message: "Expected an array" });
    return void 0;
  }
  return value.map((item, index) => readItem(item, `${path}[${index}]`, errors)).filter((item) => item !== void 0);
}
function readRequiredString(object, key, path, errors) {
  const value = object[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "Expected a non-empty string" });
    return void 0;
  }
  return value;
}
function readOptionalString(object, key, path, errors) {
  const value = object[key];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "Expected a non-empty string" });
    return void 0;
  }
  return value;
}
function readOptionalBoolean(object, key, path, errors) {
  const value = object[key];
  if (value === void 0) {
    return void 0;
  }
  if (typeof value !== "boolean") {
    errors.push({ path, message: "Expected a boolean" });
    return void 0;
  }
  return value;
}
function readStringArray(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({ path, message: "Expected a non-empty string array" });
    return void 0;
  }
  const values = [];
  for (const [index, item] of value.entries()) {
    if (typeof item !== "string" || item.trim().length === 0) {
      errors.push({ path: `${path}[${index}]`, message: "Expected a non-empty string" });
      continue;
    }
    values.push(item);
  }
  return values;
}
function readOptionalStringArray(value, path, errors) {
  if (value === void 0) {
    return void 0;
  }
  return readStringArray(value, path, errors);
}
function invalid2(errors) {
  return {
    ok: false,
    errors: Object.freeze([...errors])
  };
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readPasteHandler(value, path, errors) {
  if (!isRecord(value) || Object.keys(value).some((k) => !["kind", "command"].includes(k)) || value.kind !== "image" || typeof value.command !== "string" || !ACTION_ID_PATTERN.test(value.command)) {
    errors.push({ path, message: "Paste handler must declare kind image and a command" });
    return void 0;
  }
  return Object.freeze({ kind: "image", command: value.command });
}
function readDocumentRendererContribution(value, path, errors) {
  const invalid3 = () => {
    errors.push({ path, message: "Invalid bounded document renderer declaration" });
    return void 0;
  };
  if (!isRecord(value) || Object.keys(value).some((k) => !["id", "contexts", "fenceLanguages"].includes(k)))
    return invalid3();
  if (typeof value.id !== "string" || value.id.length > 128 || !PLUGIN_ID_PATTERN.test(value.id))
    return invalid3();
  if (!Array.isArray(value.contexts) || !value.contexts.length || value.contexts.length > 2 || new Set(value.contexts).size !== value.contexts.length || value.contexts.some((v) => v !== "text" && v !== "fence"))
    return invalid3();
  if (value.fenceLanguages !== void 0 && (!Array.isArray(value.fenceLanguages) || !value.fenceLanguages.length || value.fenceLanguages.length > 16 || value.fenceLanguages.some(
    (v) => typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_+-]{0,31}$/.test(v)
  )))
    return invalid3();
  if (value.contexts.includes("fence") !== !!value.fenceLanguages) return invalid3();
  return Object.freeze({
    id: value.id,
    contexts: Object.freeze(value.contexts),
    ...value.fenceLanguages ? { fenceLanguages: Object.freeze(value.fenceLanguages) } : {}
  });
}

// packages/plugin/src/registry.ts
var defaultNow = () => Date.now();
var snapshotVersion = 1;
var PluginRegistry = class {
  records = /* @__PURE__ */ new Map();
  auditRecords = [];
  now;
  dataRoot;
  storageRoot;
  allowedHosts;
  compatibility;
  constructor(options = {}) {
    this.now = options.now ?? defaultNow;
    this.dataRoot = normalizeRoot(options.dataRoot ?? "milkup://plugin-data");
    this.storageRoot = normalizeRoot(options.storageRoot ?? "milkup://plugin-storage");
    this.allowedHosts = Object.freeze([...options.allowedHosts ?? ["worker"]]);
    this.compatibility = options.compatibility;
  }
  installLocalPlugin(descriptor) {
    const manifest = parsePluginManifest(descriptor.manifest);
    const rootPath = descriptor.rootPath ?? directoryOf(descriptor.manifestPath);
    const sourcePath = descriptor.sourcePath ?? descriptor.manifestPath;
    const installedAt = descriptor.installedAt ?? this.now();
    const existing = this.records.get(manifest.id);
    const errors = validatePluginCompatibility(manifest, this.compatibility);
    const host = manifest.host ?? "worker";
    const sameScope = !!existing && JSON.stringify([
      existing.manifest.host ?? "worker",
      [...existing.manifest.permissions ?? []].sort(),
      [...existing.manifest.networkOrigins ?? []].sort()
    ]) === JSON.stringify([
      host,
      [...manifest.permissions ?? []].sort(),
      [...manifest.networkOrigins ?? []].sort()
    ]);
    const remainsEnabled = sameScope && existing?.enabled === true && (existing.manifest.host ?? "worker") === host && errors.length === 0;
    const record = freezeRecord({
      manifest,
      manifestPath: descriptor.manifestPath,
      rootPath,
      sourcePath,
      state: remainsEnabled ? "enabled" : errors.length ? "failed" : "disabled",
      enabled: remainsEnabled,
      installedAt: existing?.installedAt ?? installedAt,
      updatedAt: this.now(),
      trust: descriptor.trust ?? existing?.trust ?? "development",
      dataRoot: pluginScopedPath(this.dataRoot, manifest.id),
      storageRoot: pluginScopedPath(this.storageRoot, manifest.id),
      approvals: Object.freeze({
        permissions: Object.freeze(
          (sameScope ? existing?.approvals.permissions ?? [] : []).filter(
            (permission) => manifest.permissions?.includes(permission)
          )
        ),
        hosts: Object.freeze(
          host === "worker" || sameScope && existing?.approvals.hosts.includes(host) ? [host] : []
        )
      }),
      errors: Object.freeze(errors),
      ...sameScope && existing?.approvals.networkOrigins ? {
        approvals: Object.freeze({
          permissions: Object.freeze([...existing.approvals.permissions]),
          hosts: Object.freeze([...existing.approvals.hosts]),
          networkOrigins: Object.freeze([...existing.approvals.networkOrigins])
        })
      } : {}
    });
    this.records.set(manifest.id, record);
    this.recordAudit(manifest.id, "install", errors.join("; ") || void 0, errors.length > 0);
    return record;
  }
  restore(snapshot) {
    snapshot = validateRegistrySnapshot(snapshot);
    this.records.clear();
    this.auditRecords.length = 0;
    if (snapshot.version !== snapshotVersion) {
      throw new Error(`Unsupported plugin registry snapshot: ${snapshot.version}`);
    }
    for (const record of snapshot.records) {
      const manifest = parsePluginManifest(record.manifest);
      const errors = [
        .../* @__PURE__ */ new Set([
          ...record.errors,
          ...validatePluginCompatibility(manifest, this.compatibility)
        ])
      ];
      this.records.set(
        manifest.id,
        freezeRecord({
          ...record,
          manifest,
          enabled: errors.length === 0 && record.enabled && record.state === "enabled",
          state: errors.length ? "failed" : record.state,
          errors
        })
      );
    }
    for (const audit of snapshot.auditRecords ?? []) {
      this.auditRecords.push(Object.freeze({ ...audit }));
    }
  }
  snapshot() {
    return Object.freeze({
      version: snapshotVersion,
      records: Object.freeze([...this.records.values()].map(cloneRecord)),
      auditRecords: Object.freeze(this.auditRecords.map((record) => Object.freeze({ ...record })))
    });
  }
  list() {
    return Object.freeze([...this.records.values()].map(cloneRecord));
  }
  get(pluginId) {
    const record = this.records.get(pluginId);
    return record ? cloneRecord(record) : void 0;
  }
  markEnabled(pluginId) {
    const record = this.require(pluginId);
    const { runtimeFailure: _failure, ...rest } = record;
    const next = freezeRecord({
      ...rest,
      enabled: true,
      state: "enabled",
      updatedAt: this.now(),
      errors: Object.freeze([])
    });
    this.records.set(pluginId, next);
    this.recordAudit(pluginId, "enable");
    return next;
  }
  markDisabled(pluginId) {
    const record = this.require(pluginId);
    const next = freezeRecord({
      ...record,
      enabled: false,
      state: "disabled",
      updatedAt: this.now()
    });
    this.records.set(pluginId, next);
    this.recordAudit(pluginId, "disable");
    return next;
  }
  markFailed(pluginId, error, runtimeKind) {
    const record = this.require(pluginId);
    const message = error instanceof Error ? error.message : String(error);
    const { runtimeFailure: _failure, ...rest } = record;
    const next = freezeRecord({
      ...rest,
      ...runtimeKind ? { runtimeFailure: Object.freeze({ kind: runtimeKind, message }) } : {},
      enabled: false,
      state: "failed",
      updatedAt: this.now(),
      errors: Object.freeze([...record.errors, message])
    });
    this.records.set(pluginId, next);
    this.recordAudit(pluginId, "enable", message, true);
    return next;
  }
  approve(pluginId) {
    const record = this.require(pluginId);
    const host = record.manifest.host ?? "worker";
    const next = freezeRecord({
      ...record,
      approvals: Object.freeze({
        permissions: Object.freeze([...record.manifest.permissions ?? []]),
        hosts: Object.freeze([host]),
        networkOrigins: Object.freeze([...record.manifest.networkOrigins ?? []])
      }),
      enabled: false,
      state: "disabled",
      errors: Object.freeze(
        record.errors.filter((error) => !error.startsWith("Plugin capabilities require approval:"))
      ),
      updatedAt: this.now()
    });
    this.records.set(pluginId, next);
    this.recordAudit(pluginId, "approval", "approved");
    return next;
  }
  revokeApproval(pluginId) {
    const record = this.require(pluginId);
    const host = record.manifest.host ?? "worker";
    const next = freezeRecord({
      ...record,
      enabled: false,
      state: "disabled",
      approvals: Object.freeze({
        permissions: Object.freeze([]),
        networkOrigins: Object.freeze([]),
        hosts: Object.freeze(host === "worker" ? ["worker"] : [])
      }),
      updatedAt: this.now()
    });
    this.records.set(pluginId, next);
    this.recordAudit(pluginId, "approval", "revoked");
    return next;
  }
  setRoots(pluginId, roots) {
    const record = this.require(pluginId);
    const next = freezeRecord({
      ...record,
      ...roots.rootPath ? { rootPath: roots.rootPath } : {},
      dataRoot: roots.dataRoot,
      storageRoot: roots.storageRoot,
      updatedAt: this.now()
    });
    this.records.set(pluginId, next);
    return next;
  }
  remove(pluginId) {
    const record = this.records.get(pluginId);
    this.records.delete(pluginId);
    if (record) {
      this.recordAudit(pluginId, "remove");
      return cloneRecord(record);
    }
    return void 0;
  }
  recordAudit(pluginId, operation, detail, denied = false) {
    this.auditRecords.push(
      Object.freeze({
        pluginId,
        operation,
        at: this.now(),
        ...detail ? { detail } : {},
        ...denied ? { denied: true } : {}
      })
    );
  }
  auditLog() {
    return Object.freeze([...this.auditRecords]);
  }
  require(pluginId) {
    const record = this.records.get(pluginId);
    if (!record) {
      throw new Error(`Unknown plugin registry record: ${pluginId}`);
    }
    return record;
  }
};
function createPluginScopedStorage(pluginId, host) {
  const prefix = `milkup.plugin.storage.${pluginId}.`;
  return Object.freeze({
    getItem: (key) => host.getItem(prefix + key),
    setItem: (key, value) => {
      host.setItem(prefix + key, value);
    },
    removeItem: (key) => {
      host.removeItem(prefix + key);
    }
  });
}
function createPluginContributionIndex(records, actions = []) {
  const enabled = records.filter((record) => record.enabled && record.state === "enabled");
  const pluginCommandIds = new Set(
    enabled.flatMap(
      (record) => (record.manifest.contributes?.commands ?? []).map((command) => command.action)
    )
  );
  let claimedPaste = false;
  const pasteHandlers = enabled.flatMap(
    (record) => (record.manifest.contributes?.pasteHandlers ?? []).map((handler) => {
      const valid2 = record.manifest.permissions?.includes("images:import") && actions.some((a) => a.id === handler.command);
      const status = !valid2 ? "invalid" : claimedPaste ? "shadowed" : "active";
      if (valid2) claimedPaste = true;
      return Object.freeze({ ...handler, pluginId: record.manifest.id, status });
    })
  );
  return Object.freeze({
    pasteHandlers: Object.freeze(pasteHandlers),
    documentRenderers: Object.freeze(
      enabled.flatMap(
        (record) => (record.manifest.contributes?.documentRenderers ?? []).map(
          (renderer) => Object.freeze({ ...renderer, pluginId: record.manifest.id })
        )
      )
    ),
    commands: Object.freeze(actions.filter((action) => pluginCommandIds.has(action.id))),
    keymaps: Object.freeze(resolvePluginKeymaps(enabled, actions)),
    renderers: Object.freeze(
      enabled.flatMap(
        (record) => (record.manifest.contributes?.renderers ?? []).map(
          (renderer) => Object.freeze({ ...renderer, pluginId: record.manifest.id })
        )
      )
    ),
    markdownSyntax: Object.freeze(
      enabled.flatMap(
        (record) => (record.manifest.contributes?.markdownSyntax ?? []).map(
          (syntax) => Object.freeze({ ...syntax, pluginId: record.manifest.id })
        )
      )
    ),
    ui: Object.freeze(
      enabled.flatMap(
        (record) => (record.manifest.contributes?.ui ?? []).map(
          (ui) => Object.freeze({ ...ui, pluginId: record.manifest.id })
        )
      )
    ),
    importers: Object.freeze(
      enabled.flatMap(
        (record) => (record.manifest.contributes?.importers ?? []).map(
          (importer) => Object.freeze({ ...importer, pluginId: record.manifest.id })
        )
      )
    ),
    documentTypes: Object.freeze(
      enabled.flatMap(
        (record) => (record.manifest.contributes?.documentTypes ?? []).map(
          (documentType) => Object.freeze({ ...documentType, pluginId: record.manifest.id })
        )
      )
    )
  });
}
function serializePluginRegistry(registry) {
  return JSON.stringify(registry.snapshot());
}
function parsePluginRegistrySnapshot(text) {
  return validateRegistrySnapshot(JSON.parse(text));
}
function validateRegistrySnapshot(value) {
  const fail = (detail) => {
    throw new Error("Invalid plugin registry snapshot: " + detail);
  };
  const object = (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail("object");
    return v;
  };
  const strings = (v) => {
    if (!Array.isArray(v) || v.length > 2048 || !v.every((x) => typeof x === "string" && x.length <= 65536))
      return fail("string list");
    return Object.freeze([...v]);
  };
  const input = object(value);
  if (input.version !== snapshotVersion || !Array.isArray(input.records) || input.records.length > 512)
    return fail("version/records");
  const ids = /* @__PURE__ */ new Set();
  const records = input.records.map((raw) => {
    const r = object(raw), manifest = parsePluginManifest(r.manifest), host = manifest.host ?? "worker";
    if (ids.has(manifest.id)) return fail("duplicate id " + manifest.id);
    ids.add(manifest.id);
    for (const key of ["manifestPath", "rootPath", "sourcePath", "dataRoot", "storageRoot"])
      if (typeof r[key] !== "string" || !r[key] || r[key].length > 8192 || /[\u0000-\u001f]/.test(r[key]))
        return fail(key);
    for (const key of ["installedAt", "updatedAt"])
      if (typeof r[key] !== "number" || !Number.isFinite(r[key]) || r[key] < 0)
        return fail(key);
    if (typeof r.enabled !== "boolean" || !["installed", "enabled", "disabled", "failed"].includes(r.state) || !["development", "trusted", "untrusted"].includes(r.trust))
      return fail("state");
    if (r.enabled !== (r.state === "enabled")) return fail("enabled/state mismatch");
    const approvals = object(r.approvals), permissions = strings(approvals.permissions), hosts = strings(approvals.hosts);
    if (new Set(permissions).size !== permissions.length || permissions.some((x) => !manifest.permissions?.includes(x)))
      return fail("permission scope");
    if (hosts.length > 1 || hosts.some((x) => x !== host)) return fail("host scope");
    const origins = approvals.networkOrigins === void 0 ? void 0 : strings(approvals.networkOrigins);
    if (origins && (new Set(origins).size !== origins.length || origins.some((x) => !manifest.networkOrigins?.includes(x))))
      return fail("origin scope");
    const errors = strings(r.errors);
    if (r.runtimeFailure !== void 0) {
      const f = object(r.runtimeFailure);
      if (!["execution-host", "renderer-timeout"].includes(f.kind) || typeof f.message !== "string")
        return fail("runtime failure");
    }
    return freezeRecord({
      ...r,
      manifest,
      errors,
      approvals: Object.freeze({
        permissions,
        hosts,
        ...origins ? { networkOrigins: origins } : {}
      })
    });
  });
  const auditRecords = input.auditRecords === void 0 ? [] : input.auditRecords;
  if (!Array.isArray(auditRecords) || auditRecords.length > 1e4) return fail("audit records");
  const operations = [
    "install",
    "enable",
    "disable",
    "reload",
    "remove",
    "file",
    "network",
    "storage",
    "sidecar",
    "approval"
  ];
  for (const raw of auditRecords) {
    const a = object(raw);
    if (typeof a.pluginId !== "string" || !operations.includes(a.operation) || typeof a.at !== "number" || !Number.isFinite(a.at) || a.detail !== void 0 && typeof a.detail !== "string" || a.denied !== void 0 && typeof a.denied !== "boolean")
      return fail("audit record");
  }
  return Object.freeze({
    version: 1,
    records: Object.freeze(records),
    auditRecords: Object.freeze(auditRecords.map((x) => Object.freeze({ ...x })))
  });
}
function resolvePluginKeymaps(records, actions) {
  const actionsById = new Set(actions.map((action) => action.id));
  const claimed = /* @__PURE__ */ new Map();
  const bindings = [];
  for (const record of records) {
    for (const keymap of record.manifest.contributes?.keymaps ?? []) {
      bindings.push(resolvePluginKeymap(record.manifest.id, keymap, actionsById, claimed));
    }
  }
  return bindings;
}
function resolvePluginKeymap(pluginId, keymap, actionsById, claimed) {
  const normalizedKey = normalizeKeymap(keymap.key);
  const conflictKey = `${normalizedKey}|${keymap.when ?? ""}`;
  const conflictWith = claimed.get(conflictKey);
  if (!actionsById.has(keymap.command)) {
    return Object.freeze({
      pluginId,
      command: keymap.command,
      key: normalizedKey,
      ...keymap.when ? { when: keymap.when } : {},
      status: "invalid"
    });
  }
  if (conflictWith) {
    return Object.freeze({
      pluginId,
      command: keymap.command,
      key: normalizedKey,
      ...keymap.when ? { when: keymap.when } : {},
      status: "shadowed",
      conflictWith
    });
  }
  claimed.set(conflictKey, keymap.command);
  return Object.freeze({
    pluginId,
    command: keymap.command,
    key: normalizedKey,
    ...keymap.when ? { when: keymap.when } : {},
    status: "active"
  });
}
function validatePluginCompatibility(manifest, compatibility) {
  if (!compatibility || !manifest.engines) {
    return [];
  }
  const errors = [];
  if (manifest.engines.milkup && !isCompatibleVersionRange(manifest.engines.milkup, compatibility.milkupVersion)) {
    errors.push(`Requires Milkup ${manifest.engines.milkup}`);
  }
  if (manifest.engines.pluginSdk && !isCompatibleVersionRange(manifest.engines.pluginSdk, compatibility.pluginSdkVersion)) {
    errors.push(`Requires plugin SDK ${manifest.engines.pluginSdk}`);
  }
  return errors;
}
function isCompatibleVersionRange(range, version) {
  if (!(0, import_semver.valid)(version)) return false;
  if (range === "*") return (0, import_semver.satisfies)(version, range);
  const bounded = /^>=(\S+) <(\S+)$/.exec(range);
  if (bounded) {
    if (!(0, import_semver.valid)(bounded[1]) || !(0, import_semver.valid)(bounded[2])) return false;
    return (0, import_semver.satisfies)(version, range);
  }
  const required = range.replace(/^(\^|>=)/, "");
  if (!(0, import_semver.valid)(required)) return false;
  return (0, import_semver.satisfies)(version, range);
}
function normalizeKeymap(key) {
  return key.split("+").map((part) => part.trim()).filter(Boolean).map((part) => {
    const lower = part.toLowerCase();
    if (lower === "cmd" || lower === "command" || lower === "ctrl" || lower === "control") {
      return "Mod";
    }
    if (lower === "shift") {
      return "Shift";
    }
    if (lower === "alt" || lower === "option") {
      return "Alt";
    }
    return part.length === 1 ? part.toUpperCase() : part;
  }).join("+");
}
function directoryOf(path) {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index) : ".";
}
function normalizeRoot(path) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}
function pluginScopedPath(root, pluginId) {
  return `${normalizeRoot(root)}/${encodeURIComponent(pluginId)}`;
}
function cloneRecord(record) {
  return freezeRecord({
    ...record,
    approvals: Object.freeze({
      permissions: Object.freeze([...record.approvals.permissions]),
      hosts: Object.freeze([...record.approvals.hosts]),
      ...record.approvals.networkOrigins ? { networkOrigins: Object.freeze([...record.approvals.networkOrigins]) } : {}
    }),
    errors: Object.freeze([...record.errors])
  });
}
function freezeRecord(record) {
  return Object.freeze({
    ...record,
    approvals: Object.freeze(record.approvals),
    errors: Object.freeze([...record.errors])
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PluginRegistry,
  createPluginContributionIndex,
  createPluginScopedStorage,
  parsePluginRegistrySnapshot,
  serializePluginRegistry,
  validatePluginCompatibility
});

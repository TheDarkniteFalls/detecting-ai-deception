import { createHash } from "node:crypto";

export const INPUT_SCHEMA_VERSION = "daid_agent_claim_check_input_v1";
export const RECEIPT_SCHEMA_VERSION = "daid_agent_claim_check_receipt_v1";
export const ERROR_SCHEMA_VERSION = "daid_agent_claim_check_error_v1";

export const FINDINGS = Object.freeze([
  "supported",
  "contradicted",
  "insufficient_evidence",
]);

export const EVIDENCE_STATES = Object.freeze([
  "supports",
  "contradictory",
  "absent",
  "unknown",
  "stale",
  "inapplicable",
]);

export const CLAIM_TYPES = Object.freeze([
  "artifact-created",
  "source-used",
  "evaluation-completed",
  "tool-call-made",
  "external-effect-completed",
  "other",
]);

const CAPTURE_COMPLETENESS = Object.freeze(["complete", "partial", "unknown"]);
const MAX_JSON_NESTING = 64;
const TOP_LEVEL_FIELDS = Object.freeze(["schema_version", "claim", "evidence", "capture"]);
const CLAIM_FIELDS = Object.freeze(["id", "text", "type"]);
const EVIDENCE_REQUIRED_FIELDS = Object.freeze(["id", "requirement", "state"]);
const EVIDENCE_OPTIONAL_FIELDS = Object.freeze([
  "observed_value",
  "source_ref",
  "source_revision",
  "source_sha256",
  "observed_channel",
]);
const CAPTURE_FIELDS = Object.freeze(["completeness", "adapter_warnings"]);

const DOES_NOT_ESTABLISH = Object.freeze([
  "correctness",
  "safety",
  "identity",
  "successful-execution",
  "authority",
  "permission",
]);

const CHECKS = Object.freeze([
  Object.freeze({ id: "input-contract", state: "passed" }),
  Object.freeze({ id: "evidence-classification", state: "passed" }),
  Object.freeze({ id: "external-execution", state: "not-run" }),
  Object.freeze({ id: "identity-authentication", state: "not-run" }),
  Object.freeze({ id: "permission-validation", state: "not-run" }),
  Object.freeze({ id: "intent-assessment", state: "not-run" }),
]);

class StrictJsonError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "StrictJsonError";
    this.issue = { code, path, message };
  }
}

function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function containsUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }

  parse() {
    this.skipWhitespace();
    if (this.index === this.text.length) {
      this.fail("malformed_json", "", "input is empty");
    }
    const value = this.parseValue("", 0);
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      this.fail("trailing_content", "", "content follows the JSON document");
    }
    return value;
  }

  fail(code, path, message) {
    throw new StrictJsonError(code, path, message);
  }

  skipWhitespace() {
    while (this.index < this.text.length && " \t\r\n".includes(this.text[this.index])) {
      this.index += 1;
    }
  }

  parseValue(path, depth) {
    if (depth > MAX_JSON_NESTING) {
      this.fail("resource_limit", path, `JSON nesting exceeds ${MAX_JSON_NESTING} levels`);
    }
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === "{") return this.parseObject(path, depth);
    if (char === "[") return this.parseArray(path, depth);
    if (char === '"') return this.parseString(path);
    if (char === "t") return this.parseLiteral("true", true, path);
    if (char === "f") return this.parseLiteral("false", false, path);
    if (char === "n") return this.parseLiteral("null", null, path);
    if (char === "-" || /[0-9]/.test(char ?? "")) return this.parseNumber(path);
    this.fail("malformed_json", path, "expected a JSON value");
  }

  parseLiteral(token, value, path) {
    if (this.text.slice(this.index, this.index + token.length) !== token) {
      this.fail("malformed_json", path, `invalid JSON literal at byte-like offset ${this.index}`);
    }
    this.index += token.length;
    return value;
  }

  parseNumber(path) {
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) this.fail("malformed_json", path, "invalid JSON number");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("malformed_json", path, "non-finite JSON number");
    return value;
  }

  parseString(path) {
    if (this.text[this.index] !== '"') this.fail("malformed_json", path, "expected a JSON string");
    this.index += 1;
    let value = "";
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      this.index += 1;
      if (char === '"') {
        if (containsUnpairedSurrogate(value)) {
          this.fail("malformed_json", path, "JSON string contains an unpaired surrogate");
        }
        return value;
      }
      if (char === "\\") {
        if (this.index >= this.text.length) this.fail("malformed_json", path, "unterminated JSON escape");
        const escape = this.text[this.index];
        this.index += 1;
        const replacements = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (Object.hasOwn(replacements, escape)) {
          value += replacements[escape];
          continue;
        }
        if (escape !== "u") this.fail("malformed_json", path, "invalid JSON escape");
        const first = this.parseHexCodeUnit(path);
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.text.slice(this.index, this.index + 2) !== "\\u") {
            this.fail("malformed_json", path, "high surrogate is not followed by a low surrogate");
          }
          this.index += 2;
          const second = this.parseHexCodeUnit(path);
          if (!(second >= 0xdc00 && second <= 0xdfff)) {
            this.fail("malformed_json", path, "high surrogate is not followed by a low surrogate");
          }
          value += String.fromCharCode(first, second);
        } else if (first >= 0xdc00 && first <= 0xdfff) {
          this.fail("malformed_json", path, "low surrogate has no leading high surrogate");
        } else {
          value += String.fromCharCode(first);
        }
        continue;
      }
      if (char.charCodeAt(0) <= 0x1f) this.fail("malformed_json", path, "unescaped control character");
      value += char;
    }
    this.fail("malformed_json", path, "unterminated JSON string");
  }

  parseHexCodeUnit(path) {
    const hex = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail("malformed_json", path, "invalid Unicode escape");
    this.index += 4;
    return Number.parseInt(hex, 16);
  }

  parseObject(path, depth) {
    this.index += 1;
    const value = Object.create(null);
    const keys = new Set();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return value;
    }
    while (this.index < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("malformed_json", path, "object key must be a string");
      const key = this.parseString(path);
      const keyPath = `${path}/${escapePointer(key)}`;
      if (key !== key.normalize("NFC")) {
        this.fail("non_nfc_string", keyPath, "object key must use Unicode NFC");
      }
      if (keys.has(key)) this.fail("duplicate_key", keyPath, `duplicate object key: ${key}`);
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("malformed_json", keyPath, "missing colon after object key");
      this.index += 1;
      value[key] = this.parseValue(keyPath, depth + 1);
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return value;
      }
      if (this.text[this.index] !== ",") this.fail("malformed_json", path, "object members must be comma separated");
      this.index += 1;
    }
    this.fail("malformed_json", path, "unterminated JSON object");
  }

  parseArray(path, depth) {
    this.index += 1;
    const value = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return value;
    }
    while (this.index < this.text.length) {
      value.push(this.parseValue(`${path}/${value.length}`, depth + 1));
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return value;
      }
      if (this.text[this.index] !== ",") this.fail("malformed_json", path, "array items must be comma separated");
      this.index += 1;
    }
    this.fail("malformed_json", path, "unterminated JSON array");
  }
}

function issue(code, path, message) {
  return { code, path, message };
}

function addUnknownFields(errors, value, allowed, path) {
  for (const key of Object.keys(value).filter((item) => !allowed.includes(item)).sort()) {
    errors.push(issue("unknown_field", `${path}/${escapePointer(key)}`, `unknown field: ${key}`));
  }
}

function addMissingFields(errors, value, required, path) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      errors.push(issue("missing_field", `${path}/${escapePointer(key)}`, `missing required field: ${key}`));
    }
  }
}

function validateString(errors, value, path, { nonEmpty = true } = {}) {
  if (typeof value !== "string") {
    errors.push(issue("wrong_type", path, "value must be a string"));
    return false;
  }
  if (nonEmpty && value.trim().length === 0) {
    errors.push(issue("empty_value", path, "string must not be empty"));
    return false;
  }
  if (value !== value.normalize("NFC")) {
    errors.push(issue("non_nfc_string", path, "string must use Unicode NFC"));
    return false;
  }
  return true;
}

function validateClaim(errors, claim) {
  if (!isObject(claim)) {
    errors.push(issue("wrong_type", "/claim", "claim must be an object"));
    return;
  }
  addUnknownFields(errors, claim, CLAIM_FIELDS, "/claim");
  addMissingFields(errors, claim, CLAIM_FIELDS, "/claim");
  validateString(errors, claim.id, "/claim/id");
  validateString(errors, claim.text, "/claim/text");
  if (validateString(errors, claim.type, "/claim/type") && !CLAIM_TYPES.includes(claim.type)) {
    errors.push(issue("unknown_enum", "/claim/type", `unknown claim type: ${claim.type}`));
  }
}

function validateEvidence(errors, evidence) {
  if (!Array.isArray(evidence)) {
    errors.push(issue("wrong_type", "/evidence", "evidence must be an array"));
    return;
  }
  if (evidence.length === 0) {
    errors.push(issue("empty_value", "/evidence", "evidence must contain at least one item"));
    return;
  }
  const ids = new Set();
  for (const [index, item] of evidence.entries()) {
    const path = `/evidence/${index}`;
    if (!isObject(item)) {
      errors.push(issue("wrong_type", path, "evidence item must be an object"));
      continue;
    }
    const allowed = [...EVIDENCE_REQUIRED_FIELDS, ...EVIDENCE_OPTIONAL_FIELDS];
    addUnknownFields(errors, item, allowed, path);
    addMissingFields(errors, item, EVIDENCE_REQUIRED_FIELDS, path);
    if (validateString(errors, item.id, `${path}/id`)) {
      if (ids.has(item.id)) {
        errors.push(issue("duplicate_evidence_id", `${path}/id`, `duplicate evidence id: ${item.id}`));
      }
      ids.add(item.id);
    }
    validateString(errors, item.requirement, `${path}/requirement`);
    if (validateString(errors, item.state, `${path}/state`) && !EVIDENCE_STATES.includes(item.state)) {
      errors.push(issue("unknown_enum", `${path}/state`, `unknown evidence state: ${item.state}`));
    }
    for (const field of EVIDENCE_OPTIONAL_FIELDS) {
      if (Object.hasOwn(item, field)) {
        validateString(errors, item[field], `${path}/${field}`, { nonEmpty: false });
      }
    }
    if (typeof item.source_sha256 === "string" && !/^[0-9a-f]{64}$/.test(item.source_sha256)) {
      errors.push(issue("invalid_sha256", `${path}/source_sha256`, "source_sha256 must be 64 lowercase hex characters"));
    }
  }
}

function validateCapture(errors, capture) {
  if (!isObject(capture)) {
    errors.push(issue("wrong_type", "/capture", "capture must be an object"));
    return;
  }
  addUnknownFields(errors, capture, CAPTURE_FIELDS, "/capture");
  addMissingFields(errors, capture, CAPTURE_FIELDS, "/capture");
  if (validateString(errors, capture.completeness, "/capture/completeness")
    && !CAPTURE_COMPLETENESS.includes(capture.completeness)) {
    errors.push(issue("unknown_enum", "/capture/completeness", `unknown capture completeness: ${capture.completeness}`));
  }
  if (!Array.isArray(capture.adapter_warnings)) {
    errors.push(issue("wrong_type", "/capture/adapter_warnings", "adapter_warnings must be an array"));
  } else {
    for (const [index, warning] of capture.adapter_warnings.entries()) {
      validateString(errors, warning, `/capture/adapter_warnings/${index}`);
    }
  }
}

export function validateAgentClaimInput(value) {
  const errors = [];
  if (!isObject(value)) return [issue("wrong_type", "", "input must be an object")];
  addUnknownFields(errors, value, TOP_LEVEL_FIELDS, "");
  addMissingFields(errors, value, TOP_LEVEL_FIELDS, "");
  if (validateString(errors, value.schema_version, "/schema_version")
    && value.schema_version !== INPUT_SCHEMA_VERSION) {
    errors.push(issue("unknown_enum", "/schema_version", `schema_version must be ${INPUT_SCHEMA_VERSION}`));
  }
  if (Object.hasOwn(value, "claim")) validateClaim(errors, value.claim);
  if (Object.hasOwn(value, "evidence")) validateEvidence(errors, value.evidence);
  if (Object.hasOwn(value, "capture")) validateCapture(errors, value.capture);
  return errors;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalValue(value))}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function errorResult(rawInputSha256, errors) {
  const value = {
    schema_version: ERROR_SCHEMA_VERSION,
    accepted: false,
    raw_input_sha256: rawInputSha256,
    intent_assessment: "not-assessed",
    downstream_action_authorized: false,
    errors,
  };
  return { accepted: false, value, output: canonicalJson(value) };
}

function classify(value) {
  if (value.evidence.some((item) => item.state === "contradictory")) return "contradicted";
  const fullySupported = value.evidence.every((item) => item.state === "supports")
    && value.capture.completeness === "complete"
    && value.capture.adapter_warnings.length === 0;
  return fullySupported ? "supported" : "insufficient_evidence";
}

export function evaluateAgentClaimBytes(input) {
  if (!(input instanceof Uint8Array)) throw new TypeError("input must be a Uint8Array");
  const raw = Buffer.from(input);
  const rawInputSha256 = sha256(raw);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return errorResult(rawInputSha256, [
      issue("malformed_json", "", "input is not valid UTF-8"),
    ]);
  }

  let value;
  try {
    value = new StrictJsonParser(text).parse();
  } catch (error) {
    if (error instanceof StrictJsonError) return errorResult(rawInputSha256, [error.issue]);
    throw error;
  }

  const errors = validateAgentClaimInput(value);
  if (errors.length) return errorResult(rawInputSha256, errors);

  const canonicalInput = canonicalJson(value);
  const counts = Object.fromEntries(EVIDENCE_STATES.map((state) => [
    state,
    value.evidence.filter((item) => item.state === state).length,
  ]));
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    accepted: true,
    claim: canonicalValue(value.claim),
    finding: classify(value),
    intent_assessment: "not-assessed",
    raw_input_sha256: rawInputSha256,
    canonical_input_sha256: sha256(Buffer.from(canonicalInput, "utf8")),
    capture: canonicalValue(value.capture),
    evidence_results: canonicalValue(value.evidence),
    evidence_state_counts: counts,
    checks: CHECKS,
    downstream_action_authorized: false,
    does_not_establish: DOES_NOT_ESTABLISH,
  };
  return { accepted: true, value: receipt, output: canonicalJson(receipt) };
}

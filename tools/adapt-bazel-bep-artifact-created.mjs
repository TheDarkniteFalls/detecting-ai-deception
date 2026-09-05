#!/usr/bin/env node
// Apache-2.0. This adapter implements a narrow Bazel BEP JSON 8.7.0 profile.
// It links to, but does not copy, Bazel's Apache-2.0 protocol definition:
// https://github.com/bazelbuild/bazel/blob/8.7.0/src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  evaluateAgentClaimBytes,
} from "../src/agent-claim-check.mjs";

export const REQUEST_SCHEMA_VERSION = "daid_bazel_bep_artifact_created_request_v1";
export const ADAPTER_ERROR_SCHEMA_VERSION = "daid_bazel_bep_artifact_adapter_error_v1";
export const BAZEL_VERSION = "8.7.0";

const MAX_REQUEST_BYTES = 65_536;
const MAX_SOURCE_BYTES = 8_388_608;
const MAX_REQUEST_DEPTH = 16;
const MAX_EVENT_DEPTH = 64;
const MAX_EVENTS = 10_000;
const MAX_NAMED_SETS = 10_000;

const SOURCE_FORMAT = "bazel-build-event-protocol-json";
const SOURCE_REVISION = "Bazel BEP JSON 8.7.0";
const OBSERVED_CHANNEL = "bazel-build-event-protocol-json-file";

const TOP_LEVEL_EVENT_KEYS = new Set([
  "id", "children", "lastMessage",
  "progress", "aborted", "started", "unstructuredCommandLine",
  "structuredCommandLine", "optionsParsed", "workspaceStatus", "fetch",
  "configuration", "expanded", "configured", "action", "namedSetOfFiles",
  "completed", "testResult", "testProgress", "testSummary", "targetSummary",
  "finished", "buildToolLogs", "buildMetrics", "workspaceInfo",
  "buildMetadata", "convenienceSymlinksIdentified", "execRequest",
]);

const PAYLOAD_MEMBERS = Object.freeze([
  "progress", "aborted", "started", "unstructuredCommandLine",
  "structuredCommandLine", "optionsParsed", "workspaceStatus", "fetch",
  "configuration", "expanded", "configured", "action", "namedSetOfFiles",
  "completed", "testResult", "testProgress", "testSummary", "targetSummary",
  "finished", "buildToolLogs", "buildMetrics", "workspaceInfo",
  "buildMetadata", "convenienceSymlinksIdentified", "execRequest",
]);

const EMPTY_ID_MEMBERS = new Set([
  "started", "unstructuredCommandLine", "workspaceStatus", "optionsParsed",
  "buildFinished", "buildToolLogs", "buildMetrics", "workspace",
  "buildMetadata", "convenienceSymlinksIdentified", "execRequest",
]);

const ID_MEMBERS = new Set([
  ...EMPTY_ID_MEMBERS,
  "unknown", "progress", "structuredCommandLine", "fetch", "configuration",
  "targetConfigured", "pattern", "patternSkipped", "namedSet",
  "targetCompleted", "actionCompleted", "unconfiguredLabel", "configuredLabel",
  "testSummary", "targetSummary", "testResult", "testProgress",
]);

const ABORTED_REASONS = Object.freeze([
  "UNKNOWN", "USER_INTERRUPTED", "NO_ANALYZE", "NO_BUILD", "TIME_OUT",
  "REMOTE_ENVIRONMENT_FAILURE", "INTERNAL", "LOADING_FAILURE",
  "ANALYSIS_FAILURE", "SKIPPED", "INCOMPLETE", "OUT_OF_MEMORY",
]);

const ABORTED_REASON_BY_NUMBER = new Map([
  [0, "UNKNOWN"], [1, "USER_INTERRUPTED"], [8, "NO_ANALYZE"],
  [9, "NO_BUILD"], [2, "TIME_OUT"], [3, "REMOTE_ENVIRONMENT_FAILURE"],
  [4, "INTERNAL"], [5, "LOADING_FAILURE"], [6, "ANALYSIS_FAILURE"],
  [7, "SKIPPED"], [10, "INCOMPLETE"], [11, "OUT_OF_MEMORY"],
]);

const WARNING_ORDER = Object.freeze([
  "missing_last_message",
  "missing_announced_events",
  "selected_output_group_incomplete",
  "selected_named_set_unresolved",
  "selected_named_set_aborted",
  "selected_mapping_ambiguous",
  "selected_artifact_metadata_missing",
  "terminal_fields_missing",
  "unsupported_selected_file_form_contents",
  "unsupported_selected_file_form_symlink",
  "unsupported_selected_inline_files",
  "unsupported_selected_directory_output",
]);

const ERROR_MESSAGES = Object.freeze({
  request_unreadable: "Request could not be read.",
  request_too_large: "Request exceeds 65536 bytes.",
  request_invalid_utf8: "Request is not valid UTF-8.",
  request_depth_exceeded: "Request nesting depth exceeds 16.",
  request_malformed_json: "Request is not one complete JSON object.",
  request_duplicate_key: "Request contains a duplicate key.",
  request_explicit_null: "Null is not allowed.",
  request_unknown_field: "Field is not allowed.",
  request_missing_field: "Required field is missing.",
  request_wrong_type: "Field has the wrong type.",
  request_non_nfc: "String is not NFC.",
  request_invalid_value: "Value conflicts with the frozen request contract.",
  source_unreadable: "Source could not be read.",
  source_too_large: "Source exceeds 8388608 bytes.",
  source_sha256_mismatch: "Source SHA-256 does not match the request.",
  source_invalid_utf8: "Source is not valid UTF-8.",
  source_empty: "Source contains no events.",
  source_too_many_events: "Source exceeds 10000 non-empty events.",
  event_malformed_json: "Event is not one complete JSON object.",
  event_duplicate_key: "Event contains a duplicate key.",
  event_explicit_null: "Null is not allowed.",
  event_top_level_wrong_type: "Event must be an object.",
  event_depth_exceeded: "Event nesting depth exceeds 64.",
  unknown_event_field: "Event field is not allowed by the frozen Bazel 8.7.0 profile.",
  event_non_nfc: "String is not NFC.",
  event_missing_id: "Event id is missing.",
  event_id_invalid: "Event id is invalid.",
  event_children_wrong_type: "Children must be an array.",
  event_child_id_invalid: "Child event id is invalid.",
  last_message_wrong_type: "lastMessage must be a boolean.",
  payload_oneof_multiple: "Event contains more than one recognized payload member.",
  payload_wrong_type: "Recognized payload has the wrong type.",
  file_oneof_invalid: "File form is invalid.",
  contents_invalid_base64: "File contents is not canonical base64.",
  digest_invalid: "File digest is not hexadecimal.",
  int64_invalid: "Integer field is not in the frozen ProtoJSON form.",
  aborted_reason_invalid: "Aborted reason is invalid.",
  timestamp_invalid: "Timestamp is not in the frozen canonical form.",
  unsupported_bazel_version: "Build tool version is not the frozen 8.7.0 profile.",
  started_payload_missing: "Root started payload is missing.",
  payload_id_mismatch: "Profile-governed event id and payload do not match.",
  missing_root: "Root started event is missing.",
  root_not_first: "Root started event is not event 0.",
  multiple_root_events: "More than one root started event was posted.",
  duplicate_event_id: "Event id was posted more than once.",
  duplicate_child_id: "Child id is repeated by one event.",
  event_not_preannounced: "Event id was not announced by an earlier event.",
  orphan_event: "Event is not reachable from the root.",
  event_graph_cycle: "Event graph is cyclic.",
  last_message_not_final: "lastMessage true is not on the final event.",
  multiple_last_message: "lastMessage true appears more than once.",
  last_message_with_missing_announced: "lastMessage true conflicts with unposted announced events.",
  mapping_invariant_failed: "Selected evidence mapping violated a frozen invariant.",
  core_rejected_generated_input: "Agent Claim Check rejected adapter-generated input.",
  internal_adapter_failure: "Adapter failed without a valid receipt.",
});

class ParseFailure extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

class MappingInvariantError extends Error {}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalCompact(value) {
  return JSON.stringify(canonicalValue(value));
}

function makeIssue(code, path) {
  return { code, path, message: ERROR_MESSAGES[code] };
}

function sortIssues(errors) {
  return [...errors].sort((left, right) => (
    compareCodePoints(left.path, right.path)
    || compareCodePoints(left.code, right.code)
    || compareCodePoints(left.message, right.message)
  ));
}

function compareCodePoints(left, right) {
  const a = Array.from(left, (value) => value.codePointAt(0));
  const b = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function adapterError(stage, errors, sourceSha256) {
  const value = {
    schema_version: ADAPTER_ERROR_SCHEMA_VERSION,
    accepted: false,
    stage,
    ...(sourceSha256 === undefined ? {} : { source_sha256: sourceSha256 }),
    errors: sortIssues(errors),
    downstream_action_authorized: false,
  };
  const operational = errors.some(({ code }) => [
    "request_unreadable", "source_unreadable", "core_rejected_generated_input",
    "internal_adapter_failure",
  ].includes(code));
  return {
    accepted: false,
    coreInvoked: false,
    exitCode: operational ? 1 : 2,
    value,
    output: canonicalJson(value),
  };
}

function containsUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

class StrictParser {
  constructor(text, maxDepth) {
    this.text = text;
    this.maxDepth = maxDepth;
    this.index = 0;
    this.issues = [];
  }

  parse() {
    this.skipWhitespace();
    if (this.index === this.text.length) throw new ParseFailure("malformed");
    const value = this.parseValue("", 0);
    this.skipWhitespace();
    if (this.index !== this.text.length) throw new ParseFailure("malformed");
    return { value, issues: this.issues };
  }

  skipWhitespace() {
    while (this.index < this.text.length && " \t\r\n".includes(this.text[this.index])) this.index += 1;
  }

  parseValue(path, depth) {
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === "{" || char === "[") {
      if (depth + 1 > this.maxDepth) throw new ParseFailure("depth");
      return char === "{" ? this.parseObject(path, depth + 1) : this.parseArray(path, depth + 1);
    }
    if (char === '"') return this.parseString(path);
    if (char === "t") return this.parseLiteral("true", true);
    if (char === "f") return this.parseLiteral("false", false);
    if (char === "n") {
      const value = this.parseLiteral("null", null);
      this.issues.push({ kind: "null", path });
      return value;
    }
    if (char === "-" || /[0-9]/.test(char ?? "")) return this.parseNumber();
    throw new ParseFailure("malformed");
  }

  parseLiteral(token, value) {
    if (this.text.slice(this.index, this.index + token.length) !== token) throw new ParseFailure("malformed");
    this.index += token.length;
    return value;
  }

  parseNumber() {
    const match = this.text.slice(this.index).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
    if (!match) throw new ParseFailure("malformed");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) throw new ParseFailure("malformed");
    return value;
  }

  parseString(path) {
    this.index += 1;
    let value = "";
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      this.index += 1;
      if (char === '"') {
        if (containsUnpairedSurrogate(value)) throw new ParseFailure("malformed");
        if (path !== null && value !== value.normalize("NFC")) this.issues.push({ kind: "non-nfc", path });
        return value;
      }
      if (char === "\\") {
        if (this.index >= this.text.length) throw new ParseFailure("malformed");
        const escape = this.text[this.index];
        this.index += 1;
        const replacements = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (Object.hasOwn(replacements, escape)) {
          value += replacements[escape];
          continue;
        }
        if (escape !== "u") throw new ParseFailure("malformed");
        const first = this.parseHexCodeUnit();
        if (first >= 0xd800 && first <= 0xdbff) {
          if (this.text.slice(this.index, this.index + 2) !== "\\u") throw new ParseFailure("malformed");
          this.index += 2;
          const second = this.parseHexCodeUnit();
          if (!(second >= 0xdc00 && second <= 0xdfff)) throw new ParseFailure("malformed");
          value += String.fromCharCode(first, second);
        } else if (first >= 0xdc00 && first <= 0xdfff) throw new ParseFailure("malformed");
        else value += String.fromCharCode(first);
        continue;
      }
      if (char.charCodeAt(0) <= 0x1f) throw new ParseFailure("malformed");
      value += char;
    }
    throw new ParseFailure("malformed");
  }

  parseHexCodeUnit() {
    const hex = this.text.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ParseFailure("malformed");
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
      if (this.text[this.index] !== '"') throw new ParseFailure("malformed");
      const key = this.parseString(null);
      const childPath = `${path}/${escapePointer(key)}`;
      if (key !== key.normalize("NFC")) this.issues.push({ kind: "non-nfc", path: childPath });
      const duplicate = keys.has(key);
      if (duplicate) this.issues.push({ kind: "duplicate", path: childPath });
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") throw new ParseFailure("malformed");
      this.index += 1;
      const child = this.parseValue(childPath, depth);
      if (!duplicate) value[key] = child;
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return value;
      }
      if (this.text[this.index] !== ",") throw new ParseFailure("malformed");
      this.index += 1;
    }
    throw new ParseFailure("malformed");
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
      value.push(this.parseValue(`${path}/${value.length}`, depth));
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return value;
      }
      if (this.text[this.index] !== ",") throw new ParseFailure("malformed");
      this.index += 1;
    }
    throw new ParseFailure("malformed");
  }
}

function parserIssue(issue, base, kind) {
  const code = kind === "request"
    ? { duplicate: "request_duplicate_key", null: "request_explicit_null", "non-nfc": "request_non_nfc" }[issue.kind]
    : { duplicate: "event_duplicate_key", null: "event_explicit_null", "non-nfc": "event_non_nfc" }[issue.kind];
  return makeIssue(code, `${base}${issue.path}`);
}

function hasIssueAtOrBelow(parserIssues, kind, path) {
  return parserIssues.some((item) => item.kind === kind && (item.path === path || item.path.startsWith(`${path}/`)));
}

function addUnknown(errors, value, allowed, base) {
  for (const key of Object.keys(value).filter((item) => !allowed.includes(item))) {
    errors.push(makeIssue("request_unknown_field", `${base}/${escapePointer(key)}`));
  }
}

function addMissing(errors, value, required, base) {
  for (const key of required) {
    if (!Object.hasOwn(value, key)) errors.push(makeIssue("request_missing_field", `${base}/${escapePointer(key)}`));
  }
}

function requestString(errors, value, path, { pattern, allowEmpty = false } = {}) {
  if (value === undefined) return false;
  if (value === null) return false;
  if (typeof value !== "string") {
    errors.push(makeIssue("request_wrong_type", path));
    return false;
  }
  if ((!allowEmpty && value.length === 0) || (pattern && !pattern.test(value))) {
    errors.push(makeIssue("request_invalid_value", path));
    return false;
  }
  return true;
}

function validateRequestObject(value, parserIssues) {
  const errors = parserIssues.map((item) => parserIssue(item, "/request", "request"));
  if (!isObject(value)) {
    errors.push(makeIssue("request_wrong_type", "/request"));
    return errors;
  }
  addUnknown(errors, value, ["schema_version", "claim_id", "source", "selection"], "/request");
  addMissing(errors, value, ["schema_version", "claim_id", "source", "selection"], "/request");
  if (requestString(errors, value.schema_version, "/request/schema_version") && value.schema_version !== REQUEST_SCHEMA_VERSION) {
    errors.push(makeIssue("request_invalid_value", "/request/schema_version"));
  }
  requestString(errors, value.claim_id, "/request/claim_id");

  if (!Object.hasOwn(value, "source")) {
    // The missing-field entry above is the complete classification.
  } else if (!isObject(value.source)) errors.push(makeIssue("request_wrong_type", "/request/source"));
  else {
    addUnknown(errors, value.source, ["format", "version", "sha256"], "/request/source");
    addMissing(errors, value.source, ["format", "version", "sha256"], "/request/source");
    if (requestString(errors, value.source.format, "/request/source/format") && value.source.format !== SOURCE_FORMAT) {
      errors.push(makeIssue("request_invalid_value", "/request/source/format"));
    }
    if (requestString(errors, value.source.version, "/request/source/version") && value.source.version !== BAZEL_VERSION) {
      errors.push(makeIssue("request_invalid_value", "/request/source/version"));
    }
    requestString(errors, value.source.sha256, "/request/source/sha256", { pattern: /^[0-9a-f]{64}$/ });
  }

  if (!Object.hasOwn(value, "selection")) {
    // The missing-field entry above is the complete classification.
  } else if (!isObject(value.selection)) errors.push(makeIssue("request_wrong_type", "/request/selection"));
  else {
    addUnknown(errors, value.selection, ["build_uuid", "target_label", "configuration_id", "output_group", "artifact"], "/request/selection");
    addMissing(errors, value.selection, ["build_uuid", "target_label", "configuration_id", "output_group", "artifact"], "/request/selection");
    requestString(errors, value.selection.build_uuid, "/request/selection/build_uuid");
    requestString(errors, value.selection.target_label, "/request/selection/target_label");
    requestString(errors, value.selection.configuration_id, "/request/selection/configuration_id");
    if (requestString(errors, value.selection.output_group, "/request/selection/output_group") && value.selection.output_group !== "default") {
      errors.push(makeIssue("request_invalid_value", "/request/selection/output_group"));
    }
    const artifact = value.selection.artifact;
    if (!Object.hasOwn(value.selection, "artifact")) {
      // The missing-field entry above is the complete classification.
    } else if (!isObject(artifact)) errors.push(makeIssue("request_wrong_type", "/request/selection/artifact"));
    else {
      addUnknown(errors, artifact, ["label", "path_prefix", "name", "digest", "length"], "/request/selection/artifact");
      addMissing(errors, artifact, ["label", "path_prefix", "name", "digest", "length"], "/request/selection/artifact");
      requestString(errors, artifact.label, "/request/selection/artifact/label", { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/ });
      if (!Object.hasOwn(artifact, "path_prefix")) {
        // The missing-field entry above is the complete classification.
      } else if (!Array.isArray(artifact.path_prefix)) errors.push(makeIssue("request_wrong_type", "/request/selection/artifact/path_prefix"));
      else if (artifact.path_prefix.length === 0) errors.push(makeIssue("request_invalid_value", "/request/selection/artifact/path_prefix"));
      else artifact.path_prefix.forEach((segment, index) => {
        const path = `/request/selection/artifact/path_prefix/${index}`;
        if (requestString(errors, segment, path) && (segment === "." || segment === ".." || segment.includes("/") || segment.includes("\0"))) {
          errors.push(makeIssue("request_invalid_value", path));
        }
      });
      if (requestString(errors, artifact.name, "/request/selection/artifact/name")
        && (artifact.name === "." || artifact.name === ".." || artifact.name.includes("/") || artifact.name.includes("\0"))) {
        errors.push(makeIssue("request_invalid_value", "/request/selection/artifact/name"));
      }
      requestString(errors, artifact.digest, "/request/selection/artifact/digest", { pattern: /^[0-9a-f]+$/ });
      requestString(errors, artifact.length, "/request/selection/artifact/length", { pattern: /^(?:0|[1-9][0-9]*)$/ });
    }
  }
  return errors;
}

function parseRequestBytes(requestBytes) {
  if (!(requestBytes instanceof Uint8Array)) throw new TypeError("requestBytes must be a Uint8Array");
  if (requestBytes.byteLength > MAX_REQUEST_BYTES) {
    return { error: adapterError("request", [makeIssue("request_too_large", "/request")]) };
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(requestBytes);
  } catch {
    return { error: adapterError("request", [makeIssue("request_invalid_utf8", "/request")]) };
  }
  let parsed;
  try {
    parsed = new StrictParser(text, MAX_REQUEST_DEPTH).parse();
  } catch (error) {
    if (error instanceof ParseFailure && error.kind === "depth") {
      return { error: adapterError("request", [makeIssue("request_depth_exceeded", "/request")]) };
    }
    if (error instanceof ParseFailure) {
      return { error: adapterError("request", [makeIssue("request_malformed_json", "/request")]) };
    }
    throw error;
  }
  const errors = validateRequestObject(parsed.value, parsed.issues);
  return errors.length ? { error: adapterError("request", errors) } : { value: parsed.value };
}

function isInt32(value) {
  return typeof value === "number" && Number.isInteger(value)
    && value >= -2_147_483_648 && value <= 2_147_483_647;
}

function exactKeys(value, allowed) {
  return isObject(value) && Object.keys(value).every((key) => allowed.includes(key));
}

function normalizeString(value, defaultValue = "") {
  return value === undefined ? defaultValue : typeof value === "string" ? value : null;
}

function normalizeInt32(value, defaultValue = 0) {
  return value === undefined ? defaultValue : isInt32(value) ? Object.is(value, -0) ? 0 : value : null;
}

function normalizeStringArray(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return [...value];
}

function normalizeConfiguration(value) {
  if (!exactKeys(value, ["id"])) return null;
  const id = normalizeString(value.id);
  return id === null ? null : { id };
}

function normalizeEventId(value) {
  if (!isObject(value) || Object.keys(value).length !== 1) return null;
  const member = Object.keys(value)[0];
  if (!ID_MEMBERS.has(member) || !isObject(value[member])) return null;
  const input = value[member];
  let output;

  if (EMPTY_ID_MEMBERS.has(member)) {
    if (Object.keys(input).length !== 0) return null;
    output = {};
  } else if (member === "unknown") {
    if (!exactKeys(input, ["details"])) return null;
    const details = normalizeString(input.details);
    if (details === null) return null;
    output = { details };
  } else if (member === "progress") {
    if (!exactKeys(input, ["opaqueCount"])) return null;
    const opaqueCount = normalizeInt32(input.opaqueCount);
    if (opaqueCount === null) return null;
    output = { opaqueCount };
  } else if (member === "structuredCommandLine") {
    if (!exactKeys(input, ["commandLineLabel"])) return null;
    const commandLineLabel = normalizeString(input.commandLineLabel);
    if (commandLineLabel === null) return null;
    output = { commandLineLabel };
  } else if (member === "fetch") {
    if (!exactKeys(input, ["url", "downloader"])) return null;
    const url = normalizeString(input.url);
    let downloader = input.downloader ?? "UNKNOWN";
    if (typeof downloader === "number") downloader = new Map([[0, "UNKNOWN"], [1, "HTTP"], [2, "GRPC"]]).get(downloader);
    if (url === null || !["UNKNOWN", "HTTP", "GRPC"].includes(downloader)) return null;
    output = { url, downloader };
  } else if (member === "configuration" || member === "namedSet") {
    if (!exactKeys(input, ["id"])) return null;
    const id = normalizeString(input.id);
    if (id === null) return null;
    output = { id };
  } else if (member === "targetConfigured") {
    if (!exactKeys(input, ["label", "aspect"])) return null;
    const label = normalizeString(input.label);
    const aspect = normalizeString(input.aspect);
    if (label === null || aspect === null) return null;
    output = { label, aspect };
  } else if (member === "pattern" || member === "patternSkipped") {
    if (!exactKeys(input, ["pattern"])) return null;
    const pattern = normalizeStringArray(input.pattern);
    if (pattern === null) return null;
    output = { pattern };
  } else if (["targetCompleted", "actionCompleted", "configuredLabel", "testSummary", "targetSummary"].includes(member)) {
    const baseFields = member === "targetCompleted" ? ["label", "aspect", "configuration"]
      : member === "actionCompleted" ? ["primaryOutput", "label", "configuration"]
        : ["label", "configuration"];
    if (!exactKeys(input, baseFields)) return null;
    output = {};
    for (const field of baseFields.filter((item) => item !== "configuration")) {
      const normalized = normalizeString(input[field]);
      if (normalized === null) return null;
      output[field] = normalized;
    }
    if (Object.hasOwn(input, "configuration")) {
      const configuration = normalizeConfiguration(input.configuration);
      if (configuration === null) return null;
      output.configuration = configuration;
    }
  } else if (member === "unconfiguredLabel") {
    if (!exactKeys(input, ["label"])) return null;
    const label = normalizeString(input.label);
    if (label === null) return null;
    output = { label };
  } else if (member === "testResult" || member === "testProgress") {
    const numeric = member === "testResult" ? ["run", "shard", "attempt"] : ["run", "shard", "attempt", "opaqueCount"];
    if (!exactKeys(input, ["label", "configuration", ...numeric])) return null;
    const label = normalizeString(input.label);
    if (label === null) return null;
    output = { label };
    if (Object.hasOwn(input, "configuration")) {
      const configuration = normalizeConfiguration(input.configuration);
      if (configuration === null) return null;
      output.configuration = configuration;
    }
    for (const field of numeric) {
      const normalized = normalizeInt32(input[field]);
      if (normalized === null) return null;
      output[field] = normalized;
    }
  } else return null;

  const normalized = { [member]: output };
  return { member, data: output, value: normalized, canonical: canonicalCompact(normalized) };
}

function eventPath(index, suffix = "") {
  return `/events/${index}${suffix}`;
}

function eventTypeError(errors, index, suffix) {
  errors.push(makeIssue("payload_wrong_type", eventPath(index, suffix)));
}

function payloadString(errors, index, object, key, base, defaultValue = "") {
  if (!Object.hasOwn(object, key)) return defaultValue;
  if (object[key] === null) return null;
  if (typeof object[key] !== "string") {
    eventTypeError(errors, index, `${base}/${key}`);
    return null;
  }
  return object[key];
}

function payloadBoolean(errors, index, object, key, base, defaultValue = false) {
  if (!Object.hasOwn(object, key)) return defaultValue;
  if (object[key] === null) return null;
  if (typeof object[key] !== "boolean") {
    eventTypeError(errors, index, `${base}/${key}`);
    return null;
  }
  return object[key];
}

function payloadArray(errors, index, object, key, base) {
  if (!Object.hasOwn(object, key)) return [];
  if (object[key] === null) return null;
  if (!Array.isArray(object[key])) {
    eventTypeError(errors, index, `${base}/${key}`);
    return null;
  }
  return object[key];
}

function canonicalBase64(value) {
  if (typeof value !== "string") return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (value.endsWith("==")) return (alphabet.indexOf(value.at(-3)) & 0x0f) === 0;
  if (value.endsWith("=")) return (alphabet.indexOf(value.at(-2)) & 0x03) === 0;
  return true;
}

function parseFile(errors, index, value, base) {
  if (!isObject(value)) {
    eventTypeError(errors, index, base);
    return null;
  }
  const pathPrefixRaw = payloadArray(errors, index, value, "pathPrefix", base);
  let pathPrefix = null;
  if (pathPrefixRaw !== null) {
    pathPrefix = [];
    pathPrefixRaw.forEach((segment, itemIndex) => {
      if (typeof segment !== "string") eventTypeError(errors, index, `${base}/pathPrefix/${itemIndex}`);
      else pathPrefix.push(segment);
    });
  }
  const name = payloadString(errors, index, value, "name", base);
  const digest = payloadString(errors, index, value, "digest", base);
  if (digest !== null && digest !== "" && !/^[0-9a-fA-F]+$/.test(digest)) {
    errors.push(makeIssue("digest_invalid", eventPath(index, `${base}/digest`)));
  }
  let length = "0";
  if (Object.hasOwn(value, "length")) {
    if (value.length === null) length = null;
    else if (typeof value.length !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value.length)) {
      errors.push(makeIssue("int64_invalid", eventPath(index, `${base}/length`)));
      length = null;
    } else length = value.length;
  }
  const oneofKeys = ["uri", "contents", "symlinkTargetPath"].filter((key) => Object.hasOwn(value, key));
  if (oneofKeys.length > 1) errors.push(makeIssue("file_oneof_invalid", eventPath(index, base)));
  const uri = payloadString(errors, index, value, "uri", base);
  const symlinkTargetPath = payloadString(errors, index, value, "symlinkTargetPath", base);
  let contents = "";
  if (Object.hasOwn(value, "contents")) {
    if (value.contents === null) contents = null;
    else if (typeof value.contents !== "string") {
      eventTypeError(errors, index, `${base}/contents`);
      contents = null;
    } else if (!canonicalBase64(value.contents)) {
      errors.push(makeIssue("contents_invalid_base64", eventPath(index, `${base}/contents`)));
      contents = null;
    } else contents = value.contents;
  }
  const form = oneofKeys.length === 1 ? ({ uri: "uri", contents: "contents", symlinkTargetPath: "symlink" })[oneofKeys[0]] : "none";
  return {
    pathPrefix: pathPrefix ?? [],
    name: name ?? "",
    digest: digest === null ? "" : digest.toLowerCase(),
    length: length ?? "0",
    form,
    uri: uri ?? "",
    contents: contents ?? "",
    symlinkTargetPath: symlinkTargetPath ?? "",
    canonical: canonicalCompact(value),
  };
}

function parseFileSetRefs(errors, index, values, base) {
  const output = [];
  values.forEach((value, itemIndex) => {
    const path = `${base}/${itemIndex}`;
    if (!isObject(value) || !exactKeys(value, ["id"]) || typeof (value.id ?? "") !== "string") {
      eventTypeError(errors, index, path);
      return;
    }
    output.push(value.id ?? "");
  });
  return output;
}

function parseFileArray(errors, index, values, base) {
  return values.map((value, itemIndex) => parseFile(errors, index, value, `${base}/${itemIndex}`)).filter(Boolean);
}

function canonicalTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  if (numericYear < 1 || numericYear > 9999 || numericMonth < 1 || numericMonth > 12) return false;
  const leapYear = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return numericDay >= 1
    && numericDay <= daysInMonth[numericMonth - 1]
    && numericHour >= 0
    && numericHour <= 23
    && numericMinute >= 0
    && numericMinute <= 59
    && numericSecond >= 0
    && numericSecond <= 59;
}

function parsePayload(errors, record) {
  const { index, value, payloadName } = record;
  if (payloadName === null) return null;
  const payload = value[payloadName];
  const base = `/${payloadName}`;
  if (!isObject(payload)) {
    eventTypeError(errors, index, base);
    return null;
  }
  if (payloadName === "started") {
    return {
      uuid: payloadString(errors, index, payload, "uuid", base),
      buildToolVersion: payloadString(errors, index, payload, "buildToolVersion", base),
      command: payloadString(errors, index, payload, "command", base),
    };
  }
  if (payloadName === "aborted") {
    let reason = payload.reason ?? "UNKNOWN";
    if (typeof reason === "number" && isInt32(reason)) reason = ABORTED_REASON_BY_NUMBER.get(Object.is(reason, -0) ? 0 : reason);
    if (!ABORTED_REASONS.includes(reason)) {
      errors.push(makeIssue("aborted_reason_invalid", eventPath(index, `${base}/reason`)));
      reason = null;
    }
    const description = payloadString(errors, index, payload, "description", base);
    return { reason: reason ?? "UNKNOWN", description: description ?? "" };
  }
  if (payloadName === "completed") {
    const success = payloadBoolean(errors, index, payload, "success", base);
    const groupsRaw = payloadArray(errors, index, payload, "outputGroup", base);
    const directoryRaw = payloadArray(errors, index, payload, "directoryOutput", base);
    const importantRaw = payloadArray(errors, index, payload, "importantOutput", base);
    const outputGroup = [];
    (groupsRaw ?? []).forEach((group, groupIndex) => {
      const groupBase = `${base}/outputGroup/${groupIndex}`;
      if (!isObject(group)) {
        eventTypeError(errors, index, groupBase);
        return;
      }
      const fileSetsRaw = payloadArray(errors, index, group, "fileSets", groupBase);
      const inlineRaw = payloadArray(errors, index, group, "inlineFiles", groupBase);
      outputGroup.push({
        name: payloadString(errors, index, group, "name", groupBase) ?? "",
        incomplete: payloadBoolean(errors, index, group, "incomplete", groupBase) ?? false,
        fileSets: parseFileSetRefs(errors, index, fileSetsRaw ?? [], `${groupBase}/fileSets`),
        inlineFiles: parseFileArray(errors, index, inlineRaw ?? [], `${groupBase}/inlineFiles`),
        canonical: canonicalCompact(group),
      });
    });
    return {
      success: success ?? false,
      outputGroup,
      directoryOutput: parseFileArray(errors, index, directoryRaw ?? [], `${base}/directoryOutput`),
      importantOutput: parseFileArray(errors, index, importantRaw ?? [], `${base}/importantOutput`),
    };
  }
  if (payloadName === "namedSetOfFiles") {
    const filesRaw = payloadArray(errors, index, payload, "files", base);
    const setsRaw = payloadArray(errors, index, payload, "fileSets", base);
    return {
      files: parseFileArray(errors, index, filesRaw ?? [], `${base}/files`),
      fileSets: parseFileSetRefs(errors, index, setsRaw ?? [], `${base}/fileSets`),
    };
  }
  if (payloadName === "finished") {
    let exitCode = null;
    if (Object.hasOwn(payload, "exitCode")) {
      if (!isObject(payload.exitCode)) eventTypeError(errors, index, `${base}/exitCode`);
      else {
        let code = payload.exitCode.code ?? 0;
        if (!isInt32(code)) {
          eventTypeError(errors, index, `${base}/exitCode/code`);
          code = null;
        }
        const name = payloadString(errors, index, payload.exitCode, "name", `${base}/exitCode`);
        exitCode = code === null ? null : { code: Object.is(code, -0) ? 0 : code, name: name ?? "" };
      }
    }
    let finishTime = null;
    if (Object.hasOwn(payload, "finishTime")) {
      if (typeof payload.finishTime !== "string") eventTypeError(errors, index, `${base}/finishTime`);
      else if (!canonicalTimestamp(payload.finishTime)) errors.push(makeIssue("timestamp_invalid", eventPath(index, `${base}/finishTime`)));
      else finishTime = payload.finishTime;
    }
    return { exitCode, finishTime };
  }
  return {};
}

function issueUnderUnknownField(issue, unknownKeys) {
  return unknownKeys.some((key) => issue.path === `/${escapePointer(key)}` || issue.path.startsWith(`/${escapePointer(key)}/`));
}

function parseEventLine(line, index, errors) {
  let parsed;
  try {
    parsed = new StrictParser(line, MAX_EVENT_DEPTH).parse();
  } catch (error) {
    if (error instanceof ParseFailure && error.kind === "depth") {
      errors.push(makeIssue("event_depth_exceeded", eventPath(index)));
      return null;
    }
    if (error instanceof ParseFailure) {
      errors.push(makeIssue("event_malformed_json", eventPath(index)));
      return null;
    }
    throw error;
  }
  if (!isObject(parsed.value)) {
    errors.push(makeIssue("event_top_level_wrong_type", eventPath(index)));
    return null;
  }
  const value = parsed.value;
  const unknownKeys = Object.keys(value).filter((key) => !TOP_LEVEL_EVENT_KEYS.has(key));
  for (const issue of parsed.issues) {
    if (issueUnderUnknownField(issue, unknownKeys)) continue;
    if (issue.kind === "null" && issue.path === "/lastMessage") {
      errors.push(makeIssue("last_message_wrong_type", eventPath(index, "/lastMessage")));
    } else errors.push(parserIssue(issue, eventPath(index), "event"));
  }
  if (unknownKeys.length) errors.push(makeIssue("unknown_event_field", eventPath(index)));

  const payloads = PAYLOAD_MEMBERS.filter((key) => Object.hasOwn(value, key));
  if (payloads.length > 1) errors.push(makeIssue("payload_oneof_multiple", eventPath(index)));

  let normalizedId = null;
  if (!Object.hasOwn(value, "id")) errors.push(makeIssue("event_missing_id", eventPath(index, "/id")));
  else if (!hasIssueAtOrBelow(parsed.issues, "null", "/id")) {
    normalizedId = normalizeEventId(value.id);
    if (normalizedId === null) errors.push(makeIssue("event_id_invalid", eventPath(index, "/id")));
  }

  const children = [];
  if (Object.hasOwn(value, "children") && value.children !== null) {
    if (!Array.isArray(value.children)) errors.push(makeIssue("event_children_wrong_type", eventPath(index, "/children")));
    else value.children.forEach((child, childIndex) => {
      const childPath = `/children/${childIndex}`;
      if (hasIssueAtOrBelow(parsed.issues, "null", childPath)) return;
      const normalized = normalizeEventId(child);
      if (normalized === null) errors.push(makeIssue("event_child_id_invalid", eventPath(index, childPath)));
      else children.push({ ...normalized, position: childIndex });
    });
  }

  let lastMessage = false;
  if (Object.hasOwn(value, "lastMessage")) {
    if (value.lastMessage === null) lastMessage = false;
    else if (typeof value.lastMessage !== "boolean") errors.push(makeIssue("last_message_wrong_type", eventPath(index, "/lastMessage")));
    else lastMessage = value.lastMessage;
  }

  const record = {
    index,
    value,
    parserIssues: parsed.issues,
    normalizedId,
    children,
    lastMessage,
    payloadName: payloads.length === 1 ? payloads[0] : null,
    payloadCount: payloads.length,
    payloadData: null,
  };
  if (payloads.length <= 1) record.payloadData = parsePayload(errors, record);
  return record;
}

function validateSourceProfile(records) {
  const errors = [];
  for (const record of records) {
    if (!record?.normalizedId) continue;
    const idMember = record.normalizedId.member;
    const payload = record.payloadName;
    const governed = idMember === "started" || idMember === "targetCompleted"
      || idMember === "namedSet" || idMember === "buildFinished";
    if (!governed || record.payloadCount > 1) continue;
    if (idMember === "started") {
      if (payload === null) errors.push(makeIssue("started_payload_missing", eventPath(record.index)));
      else if (payload !== "started") errors.push(makeIssue("payload_id_mismatch", eventPath(record.index)));
      else if (record.payloadData?.buildToolVersion !== BAZEL_VERSION) {
        errors.push(makeIssue("unsupported_bazel_version", eventPath(record.index, "/started/buildToolVersion")));
      }
    } else {
      const expected = idMember === "targetCompleted" ? ["completed", "aborted"]
        : idMember === "namedSet" ? ["namedSetOfFiles", "aborted"]
          : ["finished", "aborted"];
      if (payload === null || !expected.includes(payload)) errors.push(makeIssue("payload_id_mismatch", eventPath(record.index)));
    }
  }
  return errors;
}

function graphCyclePaths(recordsById) {
  const colors = new Map();
  const paths = new Set();
  for (const start of recordsById.keys()) {
    if ((colors.get(start) ?? 0) !== 0) continue;
    const stack = [{ key: start, next: 0, children: recordsById.get(start)?.children ?? [] }];
    colors.set(start, 1);
    while (stack.length) {
      const frame = stack.at(-1);
      if (frame.next >= frame.children.length) {
        colors.set(frame.key, 2);
        stack.pop();
        continue;
      }
      const child = frame.children[frame.next];
      frame.next += 1;
      const color = colors.get(child.canonical) ?? 0;
      if (color === 1) {
        paths.add(eventPath(recordsById.get(frame.key).index, `/children/${child.position}`));
        continue;
      }
      if (color === 0 && recordsById.has(child.canonical)) {
        colors.set(child.canonical, 1);
        stack.push({ key: child.canonical, next: 0, children: recordsById.get(child.canonical).children });
      }
    }
  }
  return [...paths];
}

function validateEventGraph(records) {
  const errors = [];
  const validRecords = records.filter((record) => record?.normalizedId);
  const rootKey = canonicalCompact({ started: {} });
  const roots = validRecords.filter((record) => record.normalizedId.canonical === rootKey);
  if (roots.length === 0) errors.push(makeIssue("missing_root", "/events/0"));
  else if (roots.length === 1 && roots[0].index !== 0) errors.push(makeIssue("root_not_first", eventPath(roots[0].index, "/id")));
  else if (roots.length > 1) errors.push(makeIssue("multiple_root_events", eventPath(roots[1].index, "/id")));

  const postings = new Map();
  const recordsById = new Map();
  for (const record of validRecords) {
    const key = record.normalizedId.canonical;
    const prior = postings.get(key) ?? [];
    prior.push(record);
    postings.set(key, prior);
    if (!recordsById.has(key)) recordsById.set(key, record);
  }
  for (const [key, posted] of postings) {
    if (posted.length <= 1 || (key === rootKey && roots.length > 1)) continue;
    posted.slice(1).forEach((record) => errors.push(makeIssue("duplicate_event_id", eventPath(record.index, "/id"))));
  }

  const announcements = new Map();
  for (const record of validRecords) {
    const seen = new Set();
    for (const child of record.children) {
      if (seen.has(child.canonical)) errors.push(makeIssue("duplicate_child_id", eventPath(record.index, `/children/${child.position}`)));
      seen.add(child.canonical);
      const values = announcements.get(child.canonical) ?? [];
      values.push({ parent: record, child });
      announcements.set(child.canonical, values);
    }
  }
  for (const record of validRecords) {
    if (record.normalizedId.canonical === rootKey) continue;
    const earlier = (announcements.get(record.normalizedId.canonical) ?? []).some(({ parent }) => parent.index < record.index);
    if (!earlier) errors.push(makeIssue("event_not_preannounced", eventPath(record.index, "/id")));
  }

  const reachable = new Set();
  if (roots.length) {
    const pending = [rootKey];
    while (pending.length) {
      const key = pending.pop();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const record = recordsById.get(key);
      if (record) record.children.forEach((child) => pending.push(child.canonical));
    }
  }
  for (const record of validRecords) {
    if (!reachable.has(record.normalizedId.canonical)) errors.push(makeIssue("orphan_event", eventPath(record.index, "/id")));
  }
  graphCyclePaths(recordsById).forEach((path) => errors.push(makeIssue("event_graph_cycle", path)));

  const postedKeys = new Set(recordsById.keys());
  const missingReachable = new Set([...reachable].filter((key) => !postedKeys.has(key)));
  const trueMarkers = records.filter((record) => record?.lastMessage);
  if (trueMarkers.length > 1) errors.push(makeIssue("multiple_last_message", eventPath(trueMarkers[1].index, "/lastMessage")));
  else if (trueMarkers.length === 1 && trueMarkers[0].index !== records.length - 1) {
    errors.push(makeIssue("last_message_not_final", eventPath(trueMarkers[0].index, "/lastMessage")));
  } else if (trueMarkers.length === 1 && missingReachable.size > 0) {
    errors.push(makeIssue("last_message_with_missing_announced", eventPath(trueMarkers[0].index, "/lastMessage")));
  }

  return {
    errors,
    rootKey,
    recordsById,
    reachable,
    missingReachable,
    postedKeys,
    trueMarkers,
    complete: trueMarkers.length === 1
      && trueMarkers[0].index === records.length - 1
      && missingReachable.size === 0,
  };
}

function parseSourceBytes(sourceBytes, request) {
  if (!(sourceBytes instanceof Uint8Array)) throw new TypeError("sourceBytes must be a Uint8Array");
  if (sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    return { error: adapterError("source-read", [makeIssue("source_too_large", "/source")]) };
  }
  const sourceHash = sha256(sourceBytes);
  const integrityErrors = [];
  if (sourceHash !== request.source.sha256) integrityErrors.push(makeIssue("source_sha256_mismatch", "/source"));
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
  } catch {
    integrityErrors.push(makeIssue("source_invalid_utf8", "/source"));
  }
  if (text !== undefined) {
    const lines = text.split("\n").filter((line) => !/^[ \t\r]*$/.test(line));
    if (lines.length === 0) integrityErrors.push(makeIssue("source_empty", "/source"));
    if (lines.length > MAX_EVENTS) integrityErrors.push(makeIssue("source_too_many_events", "/source"));
    if (integrityErrors.length) return { error: adapterError("source-integrity", integrityErrors, sourceHash) };
    const jsonErrors = [];
    const records = lines.map((line, index) => parseEventLine(line, index, jsonErrors));
    if (jsonErrors.length) return { error: adapterError("source-json", jsonErrors, sourceHash) };
    const profileErrors = validateSourceProfile(records);
    if (profileErrors.length) return { error: adapterError("source-profile", profileErrors, sourceHash) };
    const graph = validateEventGraph(records);
    if (graph.errors.length) return { error: adapterError("event-graph", graph.errors, sourceHash) };
    return { sourceHash, records, graph, byteLength: sourceBytes.byteLength };
  }
  return { error: adapterError("source-integrity", integrityErrors, sourceHash) };
}

function sourceRef(indices) {
  const values = [...new Set(indices)].sort((left, right) => left - right);
  return values.length ? `bep-capture#events:${values.join(",")}` : "bep-capture#stream";
}

function commonEvidence(id, requirement, state, observedValue, indices, sourceHash) {
  return {
    id,
    requirement,
    state,
    observed_value: observedValue,
    source_ref: sourceRef(indices),
    source_revision: SOURCE_REVISION,
    source_sha256: sourceHash,
    observed_channel: OBSERVED_CHANNEL,
  };
}

function stateForMissing(complete) {
  return complete ? "absent" : "unknown";
}

function namedSetKey(id) {
  return canonicalCompact({ namedSet: { id } });
}

function requestArtifactPath(request) {
  return [...request.selection.artifact.path_prefix, request.selection.artifact.name].join("/").normalize("NFC");
}

function selectedTargetRecord(records, request) {
  return records.find((record) => {
    if (record.normalizedId.member !== "targetCompleted") return false;
    const data = record.normalizedId.data;
    return data.label === request.selection.target_label
      && data.aspect === ""
      && Object.hasOwn(data, "configuration")
      && data.configuration.id === request.selection.configuration_id;
  }) ?? null;
}

function aspectIsolationCount(records, request) {
  return records.filter((record) => {
    if (record.normalizedId.member !== "targetCompleted") return false;
    const data = record.normalizedId.data;
    return data.label === request.selection.target_label
      && data.aspect !== ""
      && Object.hasOwn(data, "configuration")
      && data.configuration.id === request.selection.configuration_id;
  }).length;
}

function distinctByCanonical(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const key = value.canonical;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function traverseNamedSets(graph, initialIds, warnings) {
  const files = [];
  const indices = [];
  const namedRecords = new Map();
  for (const record of graph.recordsById.values()) {
    if (record.normalizedId.member === "namedSet") namedRecords.set(record.normalizedId.data.id, record);
  }
  const colors = new Map();
  let unresolved = false;
  let aborted = false;
  let cycle = false;
  const roots = [...new Set(initialIds)];
  for (const root of roots) {
    if ((colors.get(root) ?? 0) === 2) continue;
    const stack = [{ id: root, entered: false, next: 0, children: [] }];
    while (stack.length) {
      const frame = stack.at(-1);
      if (!frame.entered) {
        frame.entered = true;
        if (colors.size >= MAX_NAMED_SETS && !colors.has(frame.id)) throw new MappingInvariantError();
        colors.set(frame.id, 1);
        const record = namedRecords.get(frame.id);
        frame.record = record;
        if (!record) {
          unresolved = true;
          colors.set(frame.id, 2);
          stack.pop();
          continue;
        }
        indices.push(record.index);
        if (record.payloadName === "aborted") {
          aborted = true;
          colors.set(frame.id, 2);
          stack.pop();
          continue;
        }
        if (record.payloadName !== "namedSetOfFiles") throw new MappingInvariantError();
        for (const file of record.payloadData.files) files.push({ file, index: record.index });
        frame.children = record.payloadData.fileSets;
      }
      if (frame.next >= frame.children.length) {
        colors.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const child = frame.children[frame.next];
      frame.next += 1;
      const color = colors.get(child) ?? 0;
      if (color === 1) {
        cycle = true;
        continue;
      }
      if (color === 0) stack.push({ id: child, entered: false, next: 0, children: [] });
    }
  }
  if (unresolved || cycle) warnings.add("selected_named_set_unresolved");
  if (aborted) warnings.add("selected_named_set_aborted");
  return { files, indices, unresolved: unresolved || cycle, aborted };
}

function buildAgentInput(request, source) {
  const { records, graph, sourceHash, byteLength } = source;
  const complete = graph.complete;
  const warnings = new Set();
  if (graph.trueMarkers.length === 0) warnings.add("missing_last_message");
  if (graph.missingReachable.size > 0) warnings.add("missing_announced_events");

  const root = graph.recordsById.get(graph.rootKey);
  if (!root || root.payloadName !== "started") throw new MappingInvariantError();
  const started = root.payloadData;
  const invocationConflict = (started.uuid !== "" && started.uuid !== request.selection.build_uuid)
    || (started.command !== "" && started.command !== "build");
  const invocationMissing = started.uuid === "" || started.command === "";
  const invocationState = invocationConflict ? "contradictory"
    : invocationMissing ? stateForMissing(complete) : "supports";
  const invocation = commonEvidence(
    "bep-invocation-identity",
    "The capture identifies the claimed Bazel invocation and build command.",
    invocationState,
    `uuid=${started.uuid}; build_tool_version=${started.buildToolVersion}; command=${started.command}`,
    [root.index],
    sourceHash,
  );

  const target = selectedTargetRecord(records, request);
  const aspectCount = aspectIsolationCount(records, request);
  let targetState = stateForMissing(complete);
  let targetIncomplete = false;
  let selectedGroups = [];
  let targetSuccess = false;
  let targetIndices = [];
  if (target) {
    targetIndices = [target.index];
    if (target.payloadName === "aborted") targetState = "contradictory";
    else {
      targetSuccess = target.payloadData.success;
      const defaults = distinctByCanonical(target.payloadData.outputGroup.filter(({ name }) => name === "default"));
      selectedGroups = defaults;
      if (!targetSuccess) targetState = "contradictory";
      else if (defaults.length > 1) {
        targetState = "unknown";
        warnings.add("selected_mapping_ambiguous");
      } else if (defaults.length === 0 || defaults[0].fileSets.length === 0) targetState = stateForMissing(complete);
      else if (defaults[0].incomplete) {
        targetState = "unknown";
        targetIncomplete = true;
        warnings.add("selected_output_group_incomplete");
      } else targetState = "supports";
      if (defaults.some(({ incomplete }) => incomplete)) {
        targetIncomplete = true;
        warnings.add("selected_output_group_incomplete");
      }
    }
  }
  const targetEvidence = commonEvidence(
    "bep-target-result",
    "The exact base target/configuration completed successfully and its selected output group was not marked incomplete.",
    targetState,
    `target_label=${request.selection.target_label}; configuration_sha256=${sha256(Buffer.from(request.selection.configuration_id, "utf8"))}; aspect=base; success=${targetSuccess}; output_group=default; incomplete=${targetIncomplete}; aspect_isolated_count=${aspectCount}`,
    targetIndices,
    sourceHash,
  );

  const selectedSetIds = selectedGroups.flatMap(({ fileSets }) => fileSets);
  const selectedInline = selectedGroups.flatMap(({ inlineFiles }) => inlineFiles);
  if (selectedInline.length) warnings.add("unsupported_selected_inline_files");
  const selectedDirectory = target?.payloadName === "completed" ? target.payloadData.directoryOutput : [];
  if (selectedDirectory.length) warnings.add("unsupported_selected_directory_output");
  const traversal = selectedSetIds.length
    ? traverseNamedSets(graph, selectedSetIds, warnings)
    : { files: [], indices: [], unresolved: false, aborted: false };
  const expectedPath = requestArtifactPath(request);
  const pathHash = sha256(Buffer.from(expectedPath, "utf8"));
  const candidates = distinctByCanonical(traversal.files
    .filter(({ file }) => [...file.pathPrefix, file.name].join("/").normalize("NFC") === expectedPath)
    .map(({ file, index }) => ({ ...file, index })));
  let artifactState = stateForMissing(complete);
  let artifactObserved = `artifact_label=${request.selection.artifact.label}; path_sha256=${pathHash}`;
  let artifactIndices = candidates.map(({ index }) => index);
  const forceArtifactUnknown = targetIncomplete || selectedInline.length > 0 || selectedDirectory.length > 0
    || traversal.unresolved || traversal.aborted || selectedGroups.length > 1;
  const conflicts = [];
  const exact = [];
  for (const file of candidates) {
    if (file.form === "contents") warnings.add("unsupported_selected_file_form_contents");
    else if (file.form === "symlink") warnings.add("unsupported_selected_file_form_symlink");
    else if (file.form !== "uri" || file.uri === "" || file.digest === "") warnings.add("selected_artifact_metadata_missing");
    if (file.form === "uri" && file.uri !== "") {
      if (file.length !== request.selection.artifact.length
        || (file.digest !== "" && file.digest !== request.selection.artifact.digest)) conflicts.push(file);
      else if (file.digest !== "") exact.push(file);
    }
  }
  if (candidates.length > 1) warnings.add("selected_mapping_ambiguous");
  if (conflicts.length) {
    artifactState = "contradictory";
    const file = conflicts[0];
    artifactObserved = `${artifactObserved}; configured_digest=${file.digest}; length=${file.length}; form=uri`;
  } else if (candidates.length > 1 || forceArtifactUnknown) {
    artifactState = "unknown";
    const file = exact[0] ?? candidates[0];
    if (file?.form === "uri" && file.digest !== "") {
      artifactObserved = `${artifactObserved}; configured_digest=${file.digest}; length=${file.length}; form=uri`;
    }
  } else if (exact.length === 1) {
    artifactState = "supports";
    const file = exact[0];
    artifactObserved = `${artifactObserved}; configured_digest=${file.digest}; length=${file.length}; form=uri`;
  } else if (candidates.length === 1) artifactState = "unknown";
  else if (target?.payloadName === "aborted") artifactState = stateForMissing(complete);
  else if (selectedSetIds.length === 0) artifactState = stateForMissing(complete);
  artifactIndices = [...artifactIndices, ...traversal.indices];
  const artifactEvidence = commonEvidence(
    "bep-artifact-record",
    "The selected output group's transitive named-file set contains exactly one file matching the requested path, configured digest, byte length, and ordinary file-reference form.",
    artifactState,
    artifactObserved,
    artifactIndices,
    sourceHash,
  );

  const terminal = records.find((record) => record.normalizedId.member === "buildFinished") ?? null;
  let terminalState = stateForMissing(complete);
  let terminalObserved = "terminal_event=missing";
  let terminalIndices = [];
  if (terminal) {
    terminalIndices = [terminal.index];
    if (terminal.payloadName === "aborted") {
      terminalState = "contradictory";
      terminalObserved = `aborted_reason=${terminal.payloadData.reason}`;
    } else {
      const { exitCode, finishTime } = terminal.payloadData;
      const terminalFieldsMissing = !exitCode || finishTime === null;
      if (terminalFieldsMissing) warnings.add("terminal_fields_missing");
      if (exitCode && exitCode.code !== 0) {
        terminalState = "contradictory";
        terminalObserved = `exit_code=${exitCode.code}; exit_name=${exitCode.name}; finish_time=${finishTime ?? "missing"}`;
      } else if (terminalFieldsMissing) {
        terminalState = "unknown";
        terminalObserved = `exit_code=${exitCode?.code ?? "missing"}; exit_name=${exitCode?.name ?? ""}; finish_time=${finishTime ?? "missing"}`;
      } else {
        terminalState = "supports";
        terminalObserved = `exit_code=${exitCode.code}; exit_name=${exitCode.name}; finish_time=${finishTime}`;
      }
    }
  }
  const terminalEvidence = commonEvidence(
    "bep-build-terminal",
    "The same invocation has an authoritative successful BuildFinished event with a finish time.",
    terminalState,
    terminalObserved,
    terminalIndices,
    sourceHash,
  );

  const announced = new Set(records.flatMap((record) => record.children.map(({ canonical }) => canonical)));
  const streamEvidence = commonEvidence(
    "bep-stream-completeness",
    "The supplied source contains one valid, root-reachable, closed BEP event DAG and a final completion assertion.",
    complete ? "supports" : "absent",
    `posted_count=${records.length}; announced_count=${announced.size}; missing_count=${graph.missingReachable.size}; root_reachable_count=${graph.reachable.size}; final_marker=${complete}; source_byte_length=${byteLength}`,
    records.map(({ index }) => index),
    sourceHash,
  );

  const orderedWarnings = WARNING_ORDER.filter((warning) => warnings.has(warning));
  const artifact = request.selection.artifact;
  return {
    schema_version: "daid_agent_claim_check_input_v1",
    claim: {
      id: request.claim_id,
      text: `Bazel invocation ${request.selection.build_uuid} recorded the requested artifact ${artifact.label} for target ${request.selection.target_label} with configured digest ${artifact.digest} and length ${artifact.length} bytes, and the build completed successfully.`,
      type: "artifact-created",
    },
    evidence: [invocation, targetEvidence, artifactEvidence, terminalEvidence, streamEvidence],
    capture: {
      completeness: complete ? "complete" : "partial",
      adapter_warnings: orderedWarnings,
    },
  };
}

export function adaptBazelBepArtifactCreated(requestBytes, sourceBytes, options = {}) {
  let sourceHash;
  try {
    const request = parseRequestBytes(requestBytes);
    if (request.error) return request.error;
    const source = parseSourceBytes(sourceBytes, request.value);
    if (source.error) return source.error;
    sourceHash = source.sourceHash;
    if (options.forceInternalFailure) throw new Error("test-only internal failure");
    if (options.forceMappingInvariantFailure) throw new MappingInvariantError();
    let input = buildAgentInput(request.value, source);
    if (typeof options.transformGeneratedInput === "function") input = options.transformGeneratedInput(input);
    if (!isObject(input) || !Array.isArray(input.evidence) || input.evidence.length !== 5) throw new MappingInvariantError();
    const evaluator = options.coreEvaluator ?? evaluateAgentClaimBytes;
    const result = evaluator(Buffer.from(canonicalJson(input), "utf8"));
    if (!result?.accepted) {
      const error = adapterError("core", [makeIssue("core_rejected_generated_input", "/core")], sourceHash);
      return { ...error, coreInvoked: true };
    }
    return {
      accepted: true,
      coreInvoked: true,
      exitCode: 0,
      value: result.value,
      output: result.output,
      generatedInput: input,
    };
  } catch (error) {
    if (error instanceof MappingInvariantError) {
      return adapterError("mapping", [makeIssue("mapping_invariant_failed", "/mapping")], sourceHash);
    }
    return adapterError("internal", [makeIssue("internal_adapter_failure", "/internal")], sourceHash);
  }
}

async function readBounded(path, maximum) {
  const handle = await open(path, "r");
  try {
    const information = await handle.stat();
    if (information.size > maximum) return { tooLarge: true };
    const chunks = [];
    let total = 0;
    while (total <= maximum) {
      const buffer = Buffer.allocUnsafe(Math.min(65_536, maximum + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximum) return { tooLarge: true };
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return { bytes: Buffer.concat(chunks, total) };
  } finally {
    await handle.close();
  }
}

export async function runBazelBepArtifactCreatedCli(argv = process.argv.slice(2)) {
  if (argv.length !== 2) return adapterError("request", [makeIssue("request_unreadable", "/request")]);
  let requestRead;
  try {
    requestRead = await readBounded(argv[0], MAX_REQUEST_BYTES);
  } catch {
    return adapterError("request", [makeIssue("request_unreadable", "/request")]);
  }
  if (requestRead.tooLarge) return adapterError("request", [makeIssue("request_too_large", "/request")]);
  const request = parseRequestBytes(requestRead.bytes);
  if (request.error) return request.error;

  let sourceRead;
  try {
    sourceRead = await readBounded(argv[1], MAX_SOURCE_BYTES);
  } catch {
    return adapterError("source-read", [makeIssue("source_unreadable", "/source")]);
  }
  if (sourceRead.tooLarge) return adapterError("source-read", [makeIssue("source_too_large", "/source")]);
  return adaptBazelBepArtifactCreated(requestRead.bytes, sourceRead.bytes);
}

async function main() {
  const result = await runBazelBepArtifactCreatedCli();
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

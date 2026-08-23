import { EVIDENCE_STATES, FINDINGS, classifyCase } from "./classifier.mjs";

const FAILURE_CLASSES = new Set([
  "false-completion",
  "material-omission",
  "provenance-or-identity-mismatch",
  "evaluation-gap",
  "ambiguous-external-effect",
  "context-or-citation-escape",
  "control-case",
]);

const GUIDING_KEYS = [
  "what_happened",
  "why_it_matters",
  "how_we_know",
  "what_remains_unknown",
  "what_next",
];

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function validateCase(record) {
  const errors = [];
  const add = (message) => errors.push(message);

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return ["case must be an object"];
  }
  if (record.schema_version !== "deception_case_v1") add("schema_version must be deception_case_v1");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id ?? "")) add("id must be a kebab-case string");
  for (const field of ["title", "plain_scenario", "system_claim", "reviewed_through", "creator", "canonical_source"]) {
    if (!nonEmpty(record[field])) add(`${field} must be a non-empty string`);
  }
  if (record.license !== "CC BY 4.0") add("license must be CC BY 4.0");
  if (!isHttpUrl(record.canonical_source)) add("canonical_source must be an HTTP(S) URL");
  if (record.intent_assessment !== "not-assessed") add("intent_assessment must be not-assessed");
  if (!FINDINGS.includes(record.expected_finding)) add("expected_finding is invalid");

  if (!Array.isArray(record.failure_class) || record.failure_class.length === 0) {
    add("failure_class must be a non-empty array");
  } else if (record.failure_class.some((item) => !FAILURE_CLASSES.has(item))) {
    add("failure_class contains an unsupported value");
  }

  if (!Array.isArray(record.required_evidence) || record.required_evidence.length === 0) {
    add("required_evidence must be a non-empty array");
  }
  if (!Array.isArray(record.observed_evidence) || record.observed_evidence.length === 0) {
    add("observed_evidence must be a non-empty array");
  }

  const requiredIds = Array.isArray(record.required_evidence)
    ? record.required_evidence.map((item) => item?.id)
    : [];
  if (requiredIds.some((id) => !nonEmpty(id)) || new Set(requiredIds).size !== requiredIds.length) {
    add("required_evidence ids must be present and unique");
  }
  for (const item of record.required_evidence ?? []) {
    if (!nonEmpty(item?.question)) add("every required evidence item needs a question");
  }

  const observedIds = [];
  for (const item of record.observed_evidence ?? []) {
    if (!requiredIds.includes(item?.requirement_id)) add(`unknown observed requirement ${item?.requirement_id ?? "missing"}`);
    if (!EVIDENCE_STATES.includes(item?.state)) add(`invalid evidence state for ${item?.requirement_id ?? "missing"}`);
    if (!nonEmpty(item?.observation)) add(`missing observation text for ${item?.requirement_id ?? "missing"}`);
    observedIds.push(item?.requirement_id);
  }
  if (new Set(observedIds).size !== observedIds.length) add("observed requirement ids must be unique");
  if (requiredIds.some((id) => !observedIds.includes(id))) add("every required evidence item needs an observation");

  if (!record.guiding_questions || typeof record.guiding_questions !== "object") {
    add("guiding_questions must be an object");
  } else {
    for (const key of GUIDING_KEYS) {
      if (!nonEmpty(record.guiding_questions[key])) add(`guiding_questions.${key} must be present`);
    }
  }

  if (!Array.isArray(record.source_links) || record.source_links.length === 0) {
    add("source_links must be a non-empty array");
  } else {
    for (const source of record.source_links) {
      if (!nonEmpty(source?.label)) add("source label must be present");
      if (!isHttpUrl(source?.url)) add("source url must be HTTP(S)");
      if (!isHttpUrl(source?.revision_url)) add("source revision_url must be HTTP(S)");
      if (!nonEmpty(source?.reviewed_through)) add("source reviewed_through must be present");
      if (!nonEmpty(source?.license_note)) add("source license_note must be present");
    }
  }
  if (!record.reproduction || !nonEmpty(record.reproduction.summary) || !nonEmpty(record.reproduction.command)) {
    add("reproduction summary and command must be present");
  }
  if (!Array.isArray(record.limitations) || record.limitations.length === 0 || record.limitations.some((item) => !nonEmpty(item))) {
    add("limitations must be a non-empty string array");
  }

  if (errors.length === 0) {
    try {
      const actual = classifyCase(record);
      if (actual !== record.expected_finding) add(`expected_finding ${record.expected_finding} does not match ${actual}`);
    } catch (error) {
      add(`classification failed: ${error.message}`);
    }
  }
  return errors;
}

export function validatePack(pack) {
  const errors = [];
  if (pack?.schema_version !== "deception_case_pack_v1") errors.push("pack schema_version is invalid");
  if (!Array.isArray(pack?.cases) || pack.cases.length === 0) errors.push("pack cases must be a non-empty array");
  const ids = new Set();
  for (const [index, record] of (pack?.cases ?? []).entries()) {
    for (const error of validateCase(record)) errors.push(`cases[${index}]: ${error}`);
    if (ids.has(record?.id)) errors.push(`duplicate case id: ${record.id}`);
    ids.add(record?.id);
  }
  return errors;
}

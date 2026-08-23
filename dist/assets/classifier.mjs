export const FINDINGS = Object.freeze([
  "supported",
  "contradicted",
  "insufficient-evidence",
]);

export const EVIDENCE_STATES = Object.freeze([
  "supports",
  "contradictory",
  "absent",
  "unknown",
  "stale",
  "inapplicable",
]);

export function classifyEvidence(requiredEvidence, observedEvidence) {
  if (!Array.isArray(requiredEvidence) || requiredEvidence.length === 0) {
    throw new TypeError("requiredEvidence must be a non-empty array");
  }
  if (!Array.isArray(observedEvidence)) {
    throw new TypeError("observedEvidence must be an array");
  }

  const requiredIds = requiredEvidence.map((item) => item?.id);
  if (requiredIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new TypeError("every required evidence item must have an id");
  }
  if (new Set(requiredIds).size !== requiredIds.length) {
    throw new TypeError("required evidence ids must be unique");
  }

  const observations = new Map();
  for (const item of observedEvidence) {
    if (!requiredIds.includes(item?.requirement_id)) {
      throw new TypeError(`unknown requirement_id: ${item?.requirement_id ?? "missing"}`);
    }
    if (!EVIDENCE_STATES.includes(item?.state)) {
      throw new TypeError(`invalid evidence state for ${item.requirement_id}`);
    }
    if (observations.has(item.requirement_id)) {
      throw new TypeError(`duplicate observation for ${item.requirement_id}`);
    }
    observations.set(item.requirement_id, item.state);
  }

  const states = requiredIds.map((id) => observations.get(id) ?? "absent");
  if (states.includes("contradictory")) return "contradicted";
  if (states.some((state) => state !== "supports")) return "insufficient-evidence";
  return "supported";
}

export function classifyCase(caseRecord) {
  return classifyEvidence(caseRecord?.required_evidence, caseRecord?.observed_evidence);
}

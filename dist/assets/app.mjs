import { classifyCase, FINDINGS } from "./classifier.mjs";

const FINDING_LABELS = {
  supported: "Supported",
  contradicted: "Contradicted",
  "insufficient-evidence": "Insufficient evidence",
};

function announceChoice(form, record, selected) {
  const finding = classifyCase(record);
  const panel = form.closest("[data-case-interaction]")?.querySelector("[data-evidence-panel]");
  const result = form.querySelector("[data-choice-result]");
  if (!panel || !result) return;

  const matched = selected === finding;
  result.textContent = choiceMessage(selected, finding);
  result.dataset.match = matched ? "yes" : "no";
  panel.hidden = false;
  panel.classList.add("is-revealed");
  panel.querySelector("[data-reveal-heading]")?.focus({ preventScroll: true });
  panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

export function choiceMessage(selected, finding) {
  if (!FINDINGS.includes(selected) || !FINDINGS.includes(finding)) throw new TypeError("choice and finding must be valid findings");
  return selected === finding
    ? `Your choice matches the deterministic finding: ${FINDING_LABELS[finding]}.`
    : `You chose ${FINDING_LABELS[selected]}. The evidence rule finds ${FINDING_LABELS[finding]}.`;
}

export function caseMatchesFilters(caseFinding, caseClasses, findingFilter, classFilter) {
  if (!FINDINGS.includes(caseFinding) || !Array.isArray(caseClasses)) throw new TypeError("case filter input is invalid");
  const findingMatch = findingFilter === "all" || caseFinding === findingFilter;
  const classMatch = classFilter === "all" || caseClasses.includes(classFilter);
  return findingMatch && classMatch;
}

function setupCaseInteractions(cases) {
  const byId = new Map(cases.map((record) => [record.id, record]));
  for (const form of document.querySelectorAll("[data-finding-form]")) {
    const record = byId.get(form.dataset.caseId);
    if (!record) continue;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const selected = new FormData(form).get("finding");
      if (!FINDINGS.includes(selected)) {
        form.querySelector("[data-choice-result]").textContent = "Choose one finding before revealing the evidence.";
        form.querySelector("input[name='finding']")?.focus();
        return;
      }
      announceChoice(form, record, selected);
    });
  }
}

function setupLibraryFilters() {
  const form = document.querySelector("[data-library-filters]");
  const rows = [...document.querySelectorAll("[data-case-row]")];
  const count = document.querySelector("[data-filter-count]");
  if (!form || rows.length === 0) return;

  const finding = form.elements.namedItem("finding");
  const failureClass = form.elements.namedItem("class");
  const allowedFindings = new Set(["all", ...FINDINGS]);
  const allowedClasses = new Set(["all", ...new Set(rows.flatMap((row) => row.dataset.classes.split(" ")))]);
  const params = new URLSearchParams(location.search);
  const requestedFinding = params.get("finding") ?? "all";
  const requestedClass = params.get("class") ?? "all";
  finding.value = allowedFindings.has(requestedFinding) ? requestedFinding : "all";
  failureClass.value = allowedClasses.has(requestedClass) ? requestedClass : "all";

  const apply = () => {
    let visible = 0;
    for (const row of rows) {
      row.hidden = !caseMatchesFilters(row.dataset.finding, row.dataset.classes.split(" "), finding.value, failureClass.value);
      if (!row.hidden) visible += 1;
    }
    count.textContent = `${visible} of ${rows.length} cases shown`;
    const next = new URL(location.href);
    for (const [key, value] of [["finding", finding.value], ["class", failureClass.value]]) {
      if (value === "all") next.searchParams.delete(key);
      else next.searchParams.set(key, value);
    }
    history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
  };

  form.addEventListener("change", apply);
  form.addEventListener("reset", () => requestAnimationFrame(apply));
  apply();
}

async function main() {
  const casesUrl = document.body.dataset.casesUrl;
  if (!casesUrl) return;
  const response = await fetch(casesUrl, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`case data request failed: ${response.status}`);
  const pack = await response.json();
  setupCaseInteractions(pack.cases);
  setupLibraryFilters();
}

if (typeof document !== "undefined") {
  main().catch((error) => {
    document.documentElement.classList.remove("js");
    const status = document.querySelector("[data-app-status]");
    if (status) status.textContent = "Interactive controls are unavailable. The complete evidence remains readable below.";
    console.error(error);
  });
}

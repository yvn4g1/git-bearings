import type { OverviewPresentation } from "./overviewPresentation";

export function renderOverviewHtml(presentation: OverviewPresentation): string {
  const repository = presentation.repository ? `<p class="overview-repository">${escapeHtml(presentation.repository)}</p>` : "";
  if (presentation.status !== "available") return `<section class="overview" aria-label="Overview">${repository}<p class="overview-message"${presentation.unavailableReason ? ` title="${escapeHtml(presentation.unavailableReason)}"` : ""}>${escapeHtml(presentation.message ?? "")}</p></section>`;
  const banner = presentation.operationBanner ? `<p class="overview-operation">${escapeHtml(presentation.operationBanner)}</p>` : "";
  const sections = presentation.sections.map((section) => `<section class="overview-section"><h3>${escapeHtml(section.title)}</h3><dl>${section.facts.map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd${section.unavailableReason ? ` title="${escapeHtml(section.unavailableReason)}"` : ""}>${escapeHtml(fact.value ?? "")}</dd></div>`).join("")}</dl>${section.meaning ? `<p class="overview-meaning">↳ ${escapeHtml(section.meaning)}</p>` : ""}</section>`).join("");
  return `<section class="overview" aria-label="Overview">${repository}${banner}${sections}</section>`;
}

export function escapeHtml(value: string): string { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

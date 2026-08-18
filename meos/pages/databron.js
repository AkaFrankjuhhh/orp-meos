import { escapeHtml } from "../core.js";

function healthStatusTone(status, ok) {
  if (["degraded", "missing_optional", "not_configured", "unsupported_driver"].includes(String(status || ""))) return "warning";
  if (ok) return "ok";
  return "danger";
}

function healthStatusText(status, ok) {
  const labels = {
    degraded: "Aandacht",
    missing_optional: "Optioneel mist",
    not_configured: "Niet ingesteld",
    unsupported_driver: "Driver mist",
    error: "Fout"
  };
  if (labels[status]) return labels[status];
  if (ok) return "Gezond";
  return labels[status] || "Fout";
}

function healthCount(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "-";
}

export function renderHealthPill(status, ok) {
  const tone = healthStatusTone(status, ok);
  return `<span class="meos-health-pill ${tone}">${escapeHtml(healthStatusText(status, ok))}</span>`;
}

export function renderDataHealthHtml({ health, loading = false, error = "", canView = false } = {}) {
  if (!canView) return '<div class="meos-empty">Geen toegang tot databronstatus.</div>';
  if (loading) return '<div class="meos-empty">Databronstatus laden...</div>';
  if (error) return `<div class="meos-empty">Databronstatus niet beschikbaar: ${escapeHtml(error)}</div>`;
  if (!health) return '<div class="meos-empty">Nog geen databronstatus geladen.</div>';

  const counts = health.counts || {};
  const cache = health.cache || {};
  const checks = Array.isArray(health.checks) ? health.checks : [];
  const source = health.dataSource || {};
  const cacheText = cache.lastSnapshotSuccessAt
    ? `Laatste goede data: ${cache.lastSnapshotSuccessAt}`
    : "Nog geen succesvolle data-cache";

  return `
    <div class="meos-health-summary">
      <article class="meos-health-card">
        <span>Status</span>
        <div>${renderHealthPill(health.status, health.ok)}</div>
        <small>${escapeHtml(source.label || "MEOS databron")}</small>
      </article>
      <article class="meos-health-card"><span>Spelers</span><strong>${escapeHtml(healthCount(counts.players))}</strong><small>players view</small></article>
      <article class="meos-health-card"><span>Voertuigen</span><strong>${escapeHtml(healthCount(counts.vehicles))}</strong><small>vehicles view</small></article>
      <article class="meos-health-card"><span>Huizen</span><strong>${escapeHtml(healthCount(counts.housing))}</strong><small>housing view</small></article>
      <article class="meos-health-card"><span>Bevelen</span><strong>${escapeHtml(healthCount(counts.warrants))}</strong><small>warrants view</small></article>
    </div>

    <div class="meos-health-summary">
      <article class="meos-health-card"><span>Driver</span><strong>${escapeHtml(health.driver || source.driver || "-")}</strong><small>${escapeHtml(health.framework || source.framework || "-")}</small></article>
      <article class="meos-health-card"><span>Cache</span><strong>${cache.hasSnapshot ? "Aanwezig" : "Leeg"}</strong><small>${escapeHtml(cacheText)}</small></article>
      <article class="meos-health-card"><span>Dossier</span><strong>${health.caseDataPath || source.caseDataPath ? "Lokaal" : "-"}</strong><small>${escapeHtml(health.caseDataPath || source.caseDataPath || "-")}</small></article>
      <article class="meos-health-card"><span>TTL</span><strong>${escapeHtml(String(cache.ttlMs ?? "-"))} ms</strong><small>MEOS_CACHE_TTL_MS</small></article>
      <article class="meos-health-card"><span>Controle</span><strong>${escapeHtml(health.checkedAt || "-")}</strong><small>${escapeHtml(String(health.durationMs ?? 0))} ms</small></article>
      <article class="meos-health-card"><span>Configuratie</span><strong>${health.configured ? "Ingesteld" : "Mist"}</strong><small>${escapeHtml(health.error || "")}</small></article>
    </div>

    <div class="meos-health-checks">
      ${checks.map((check) => `
        <article class="meos-health-check">
          <div><span>${escapeHtml(check.label || check.key)}</span><strong>${escapeHtml(check.required ? "Verplicht" : "Optioneel")}</strong></div>
          <div><span>View</span><code>${escapeHtml(check.view || "-")}</code></div>
          <div><span>Aantal</span><strong>${escapeHtml(healthCount(check.count))}</strong></div>
          <div>${renderHealthPill(check.status, check.ok)}</div>
          ${check.error ? `<small>${escapeHtml(check.error)}</small>` : ""}
        </article>
      `).join("") || '<div class="meos-empty">Geen viewchecks beschikbaar.</div>'}
    </div>
  `;
}

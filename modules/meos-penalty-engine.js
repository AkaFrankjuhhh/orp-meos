"use strict";

function numberFromText(value) {
  const match = String(value || "").match(/\d+(?:[.,]\d+)?/);
  if (!match) return 0;
  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function euroFromText(value) {
  const match = String(value || "").match(/\d[\d.,]*/);
  if (!match) return 0;
  const parsed = Number(match[0].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function durationFromText(value, type) {
  const text = String(value || "").trim().toLowerCase();
  const amount = numberFromText(text);
  if (!amount) return 0;
  if (type === "taskHours") {
    if (/dag|dagen/.test(text)) return amount * 8;
    return amount;
  }
  if (/jaar|jaren/.test(text)) return amount * 12;
  if (/week|weken/.test(text)) return amount * 7 / 30;
  if (/dag|dagen/.test(text)) return amount / 30;
  return amount;
}

function modifierForSelection(selection = {}) {
  const factor = Math.round((1 + (selection.officialInDuty ? 0.33 : 0) - (selection.attempted ? 0.33 : 0)) * 100) / 100;
  const labels = [];
  if (selection.officialInDuty) labels.push("Ambtenaar in functie +33%");
  if (selection.attempted) labels.push("Poging tot -33%");
  return { factor: Math.max(0, factor), labels };
}

function roundPenalty(value, euros = false) {
  return euros ? Math.round(value) : Math.round(value * 10) / 10;
}

function resolveTable(article, tableIndex) {
  return (Array.isArray(article?.tables) ? article.tables : []).find((table, index) => {
    return String(table?.index ?? index) === String(tableIndex);
  }) || null;
}

function resolvePenaltySelection(articles, selection = {}) {
  const article = articles.find((item) => String(item?.id || item?.articleId || "") === String(selection.articleId || ""));
  if (!article) return null;
  const table = resolveTable(article, selection.tableIndex);
  const rowIndex = Number(selection.rowIndex);
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const row = Number.isInteger(rowIndex) && rowIndex >= 0 ? rows[rowIndex] : null;
  if (!table || !row) return null;
  const rowLabel = String(row.Feit || row.Veroordeling || row.Omschrijving || row.Titel || `Regel ${rowIndex + 1}`).trim();
  return { article, table, row, rowIndex, rowLabel };
}

function calculateWetboekPenalty(payload = {}, selections = []) {
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  if (!Array.isArray(selections) || !selections.length) {
    const error = new Error("Selecteer minimaal één strafregel uit het Wetboek.");
    error.status = 400;
    throw error;
  }

  const totals = {
    fine: 0,
    jailMonths: 0,
    taskHours: 0,
    drivingBanMonths: 0,
    rawFine: 0,
    rawJailMonths: 0,
    rawTaskHours: 0,
    rawDrivingBanMonths: 0
  };
  const snapshots = selections.map((selection) => {
    const resolved = resolvePenaltySelection(articles, selection);
    if (!resolved) {
      const error = new Error(`Wetboekselectie ${selection.articleId || "onbekend"} bestaat niet meer in de actuele revisie.`);
      error.status = 409;
      throw error;
    }
    const { article, table, row, rowIndex, rowLabel } = resolved;
    const modifier = modifierForSelection(selection);
    const fine = euroFromText(row.Boete || row.Bedrag);
    const jailMonths = durationFromText(row.Celstraf, "jailMonths");
    const taskHours = durationFromText(row.Taakstraf, "taskHours");
    const drivingBanMonths = durationFromText(row.Rijontzegging || row.Rijverbod, "drivingBanMonths");
    totals.rawFine += fine;
    totals.rawJailMonths += jailMonths;
    totals.rawTaskHours += taskHours;
    totals.rawDrivingBanMonths += drivingBanMonths;
    totals.fine += roundPenalty(fine * modifier.factor, true);
    totals.jailMonths += roundPenalty(jailMonths * modifier.factor);
    totals.taskHours += roundPenalty(taskHours * modifier.factor);
    totals.drivingBanMonths += roundPenalty(drivingBanMonths * modifier.factor);
    return {
      articleId: String(article.id || selection.articleId),
      articleTitle: String(article.title || article.heading || ""),
      category: String(article.category || article.sectionLabel || ""),
      tableIndex: String(table.index ?? selection.tableIndex),
      tableType: String(table.type || "table"),
      rowIndex: String(rowIndex),
      rowLabel,
      officialInDuty: Boolean(selection.officialInDuty),
      attempted: Boolean(selection.attempted),
      modifierFactor: modifier.factor,
      modifierLabels: modifier.labels,
      penalty: {
        fine: String(row.Boete || row.Bedrag || ""),
        jail: String(row.Celstraf || ""),
        task: String(row.Taakstraf || ""),
        drivingBan: String(row.Rijontzegging || row.Rijverbod || "")
      }
    };
  });

  const hasJail = totals.jailMonths > 0;
  const convertedTaskHours = hasJail ? totals.taskHours : 0;
  const taskToJailMonths = hasJail ? convertedTaskHours / 2 : 0;
  return {
    revision: Number(payload.revision || 0),
    updatedAt: payload.updatedAt || null,
    articleIds: snapshots.map((selection) => selection.articleId),
    selections: snapshots,
    totals: {
      ...totals,
      taskConverted: hasJail && convertedTaskHours > 0,
      convertedTaskHours: roundPenalty(convertedTaskHours),
      taskToJailMonths: roundPenalty(taskToJailMonths),
      jailMonths: roundPenalty(totals.jailMonths + taskToJailMonths),
      taskHours: hasJail ? 0 : roundPenalty(totals.taskHours),
      fine: Math.round(totals.fine),
      drivingBanMonths: roundPenalty(totals.drivingBanMonths)
    }
  };
}

module.exports = {
  calculateWetboekPenalty,
  durationFromText,
  euroFromText,
  modifierForSelection,
  resolvePenaltySelection
};

/**
 * Odoo.sh Watcher - Popup Script
 *
 * Handles the popup UI: displays cached instances, allows
 * threshold configuration, and triggers force-check.
 */

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------

const instancesList = document.getElementById("instances-list");
const instancesListExpired = document.getElementById("instances-list-expired");
const lastCheckEl = document.getElementById("last-check");
const thresholdInput = document.getElementById("threshold-input");
const saveBtn = document.getElementById("save-btn");
const forceCheckBtn = document.getElementById("force-check-btn");
const forceCheckText = document.getElementById("force-check-text");
const forceCheckSpinner = document.getElementById("force-check-spinner");
const statusMsg = document.getElementById("status-msg");
const tabExpiring = document.getElementById("tab-expiring");
const tabExpired = document.getElementById("tab-expired");
const panelExpiring = document.getElementById("panel-expiring");
const panelExpired = document.getElementById("panel-expired");
const countExpiring = document.getElementById("count-expiring");
const countExpired = document.getElementById("count-expired");
const langSelect = document.getElementById("lang-select");

let currentLocale = null;
let translations = {};

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const FALLBACK_LOCALE = "en";

/**
 * Load translations from _locales/{locale}/messages.json.
 *
 * @param {string} locale - "en" or "es"
 * @returns {Promise<Object>} Translation map
 */
async function loadTranslations(locale) {
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const resp = await fetch(url);
    const data = await resp.json();
    const map = {};
    for (const [key, val] of Object.entries(data)) {
      map[key] = val.message;
    }
    return map;
  } catch (e) {
    if (locale !== FALLBACK_LOCALE) return loadTranslations(FALLBACK_LOCALE);
    return {};
  }
}

/**
 * Get a translated message, with placeholder substitution.
 *
 * @param {string} key - Translation key
 * @param {...string} args - Substitution arguments ($1, $2, ...)
 * @returns {string} Translated text
 */
function t(key, ...args) {
  let msg = translations[key] || chrome.i18n.getMessage(key) || key;
  args.forEach((arg, i) => {
    msg = msg.replace(`$${i + 1}`, arg);
  });
  return msg;
}

/**
 * Apply translations to all elements with data-i18n attribute.
 */
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const msg = t(key);
    if (msg && msg !== key) el.textContent = msg;
  });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", async () => {
  await initLocale();
  applyI18n();
  loadThreshold();
  loadCachedData();

  tabExpiring.addEventListener("click", () => switchTab("expiring"));
  tabExpired.addEventListener("click", () => switchTab("expired"));

  langSelect.addEventListener("change", async () => {
    const locale = langSelect.value;
    chrome.storage.sync.set({ locale }, async () => {
      currentLocale = locale;
      translations = await loadTranslations(locale);
      applyI18n();
      loadCachedData();
    });
  });
});

/**
 * Initialize locale from storage or browser default.
 */
async function initLocale() {
  const result = await chrome.storage.sync.get(["locale"]);
  if (result.locale) {
    currentLocale = result.locale;
  } else {
    const langs = await chrome.i18n.getAcceptLanguages();
    currentLocale = langs[0]?.startsWith("es") ? "es" : "en";
  }
  langSelect.value = currentLocale;
  translations = await loadTranslations(currentLocale);
}

// ---------------------------------------------------------------------------
// Threshold Settings
// ---------------------------------------------------------------------------

/**
 * Load the saved threshold value from chrome.storage.sync.
 */
function loadThreshold() {
  chrome.storage.sync.get(["threshold_days"], (result) => {
    thresholdInput.value = result.threshold_days ?? 3;
  });
}

/**
 * Save the threshold value to chrome.storage.sync.
 */
saveBtn.addEventListener("click", () => {
  const value = parseInt(thresholdInput.value, 10);
  if (isNaN(value) || value < 1 || value > 30) {
    showStatus(t("enterValid"), "error");
    return;
  }

  chrome.storage.sync.set({ threshold_days: value }, () => {
    showStatus(t("settingsSaved"), "success");
    setTimeout(() => clearStatus(), 2000);
  });
});

// ---------------------------------------------------------------------------
// Force Check
// ---------------------------------------------------------------------------

forceCheckBtn.addEventListener("click", () => {
  setForceCheckLoading(true);

  chrome.runtime.sendMessage({ action: "force-check" }, (response) => {
    setForceCheckLoading(false);

    if (chrome.runtime.lastError) {
      showStatus(t("errorPrefix", chrome.runtime.lastError.message), "error");
      return;
    }

    if (response && response.success) {
      const alertCount = response.alertable ? response.alertable.length : 0;
      const total = response.instances ? response.instances.length : 0;
      showStatus(
        t("checkedInstances", total, alertCount),
        "success"
      );
      renderInstances(response.instances);
      updateLastCheck(new Date().toISOString());
    } else {
      const errMsg = response && response.error ? response.error : "Unknown error";
      showStatus(t("checkFailed", errMsg), "error");
    }

    setTimeout(() => clearStatus(), 4000);
  });
});

/**
 * Toggle the loading state of the force-check button.
 *
 * @param {boolean} loading - Whether the button should show loading state
 */
function setForceCheckLoading(loading) {
  forceCheckBtn.disabled = loading;
  forceCheckText.textContent = loading ? t("checking") : t("forceCheck");
  forceCheckSpinner.classList.toggle("hidden", !loading);
}

// ---------------------------------------------------------------------------
// Data Loading & Rendering
// ---------------------------------------------------------------------------

/**
 * Load cached instance data from the background (via storage).
 */
function loadCachedData() {
  chrome.runtime.sendMessage({ action: "get-cached" }, (response) => {
    if (chrome.runtime.lastError) {
      lastCheckEl.textContent = t("unableLoad");
      return;
    }

    if (response && response.instances) {
      renderInstances(response.instances);
    }

    if (response && response.lastCheck) {
      updateLastCheck(response.lastCheck);
    } else {
      lastCheckEl.textContent = t("noCheck");
    }
  });
}

/**
 * Switch between tab panels.
 *
 * @param {string} tabName - "expiring" or "expired"
 */
function switchTab(tabName) {
  const isExpiring = tabName === "expiring";
  tabExpiring.classList.toggle("active", isExpiring);
  tabExpired.classList.toggle("active", !isExpiring);
  panelExpiring.classList.toggle("active", isExpiring);
  panelExpired.classList.toggle("active", !isExpiring);
}

/**
 * Render the list of instances in the popup, split into expiring and expired tabs.
 * Both tabs are sorted by daysRemaining ascending.
 *
 * @param {Array} instances - Array of ParsedInstance objects
 */
function renderInstances(instances) {
  if (!instances || instances.length === 0) {
    instancesList.innerHTML =
      `<div class="empty-state">${t("noInstances")}</div>`;
    instancesListExpired.innerHTML =
      `<div class="empty-state">${t("noExpired")}</div>`;
    countExpiring.textContent = "0";
    countExpired.textContent = "0";
    return;
  }

  const sorted = [...instances].sort((a, b) => {
    if (a.daysRemaining === Infinity) return 1;
    if (b.daysRemaining === Infinity) return -1;
    return a.daysRemaining - b.daysRemaining;
  });

  const expiring = sorted.filter(
    (inst) => inst.license !== "Expired" && inst.daysRemaining >= 0
  );
  const expired = sorted.filter(
    (inst) => inst.license === "Expired" || inst.daysRemaining < 0
  );

  countExpiring.textContent = expiring.length;
  countExpired.textContent = expired.length;

  instancesList.innerHTML = renderGrouped(expiring) ||
    `<div class="empty-state">${t("noExpiring")}</div>`;
  instancesListExpired.innerHTML = renderGrouped(expired) ||
    `<div class="empty-state">${t("noExpired")}</div>`;
}

/**
 * Render instances grouped by project as HTML.
 *
 * @param {Array} insts - Array of ParsedInstance objects
 * @returns {string} HTML string
 */
function renderGrouped(insts) {
  if (insts.length === 0) return "";

  const groups = {};
  for (const inst of insts) {
    if (!groups[inst.projectName]) groups[inst.projectName] = [];
    groups[inst.projectName].push(inst);
  }

  return Object.entries(groups).map(([projectName, groupInsts]) => {
    const projectHtml = groupInsts.map(renderInstanceCard).join("");
    const license = groupInsts[0].license;
    const version = groupInsts[0].version;
    return `
      <div class="project-group">
        <div class="project-group-header">
          <span class="project-group-name">${escapeHtml(projectName)}</span>
          <span class="license-badge badge-${license.toLowerCase()}">${escapeHtml(license)}</span>
          ${version ? `<span class="instance-version">v${escapeHtml(version)}</span>` : ""}
        </div>
        <div class="project-group-branches">${projectHtml}</div>
      </div>
    `;
  }).join("");
}

/**
 * Render a single instance card as HTML.
 *
 * @param {Object} inst - ParsedInstance object
 * @returns {string} HTML string
 */
function renderInstanceCard(inst) {
  const isProject = inst.stage === "project";
  const isExpired = inst.license === "Expired";
  const daysInfo = getDaysInfo(inst.daysRemaining, inst.license);
  let name, stageLabel, badgeClass;

  if (isProject && isExpired) {
    name = t("project");
    stageLabel = t("expired");
    badgeClass = "badge-expired";
  } else if (isProject) {
    name = t("projectTrial");
    stageLabel = "Trial";
    badgeClass = "badge-trial";
  } else {
    name = inst.branchName;
    stageLabel = t("staging");
    badgeClass = "badge-staging";
  }

  return `
    <div class="instance-card">
      <div class="instance-info">
        <span class="instance-name">${escapeHtml(name)}</span>
      </div>
      <div class="instance-right">
        <span class="instance-badge ${badgeClass}">${stageLabel}</span>
        <span class="days-indicator ${daysInfo.class}">${daysInfo.text}</span>
      </div>
    </div>
  `;
}

/**
 * Get the CSS class and display text for the days remaining indicator.
 *
 * @param {number} days - Days remaining (Infinity if no expiration)
 * @returns {Object} { class: string, text: string }
 */
function getDaysInfo(days, license) {
  if (days === undefined || days === null || (typeof days === "number" && isNaN(days))) {
    return { class: "days-unknown", text: t("unknown") };
  }

  if (days === Infinity) {
    return { class: "days-unknown", text: t("noExpiry") };
  }

  if (license === "Expired" && days <= 0) {
    return { class: "days-expired", text: t("expired") };
  }

  if (days < 0) {
    return { class: "days-expired", text: `${Math.abs(days)}${t("daysLeft")}` };
  }

  if (days === 0) {
    return { class: "days-danger", text: t("today") };
  }

  if (days <= 3) {
    return { class: "days-danger", text: `${days}${t("daysLeft")}` };
  }

  if (days <= 7) {
    return { class: "days-warning", text: `${days}${t("daysLeft")}` };
  }

  return { class: "days-safe", text: `${days}${t("daysLeft")}` };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Update the "last checked" timestamp display.
 *
 * @param {string} isoString - ISO 8601 date string
 */
function updateLastCheck(isoString) {
  const date = new Date(isoString);
  const formatted = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  lastCheckEl.textContent = `${t("lastCheck")}: ${formatted}`;
}

/**
 * Show a status message in the footer.
 *
 * @param {string} msg - Message text
 * @param {string} type - "success" | "error" | ""
 */
function showStatus(msg, type = "") {
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg ${type}`;
}

/**
 * Clear the status message.
 */
function clearStatus() {
  statusMsg.textContent = "";
  statusMsg.className = "status-msg";
}

/**
 * Escape HTML special characters to prevent XSS.
 *
 * @param {string} text - Raw text
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

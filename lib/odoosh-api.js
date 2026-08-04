/**
 * Odoo.sh API Module - DOM Scraping via Scripting Injection
 *
 * Finds the user's open Odoo.sh tab (page already rendered), injects
 * DOM parser via chrome.scripting.executeScript. For branch details,
 * opens background tabs and parses their DOM.
 */

const ODOOSH_BASE_URL = "https://www.odoo.sh";
const BRANCH_FETCH_DELAY_MS = 500;
const TAB_LOAD_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Injected DOM Parsing Functions
// ---------------------------------------------------------------------------

function parseProjectListFn() {
  const BASE = "https://www.odoo.sh";
  const TRIAL_RE = /\((\d+)\s+days?\s+left\)/i;

  function txt(el) {
    return el ? el.textContent.trim() : "";
  }

  function parseLicense(td) {
    const t = txt(td);
    if (t.toLowerCase().includes("trial")) return "Trial";
    if (t.toLowerCase().includes("expired")) return "Expired";
    if (td.classList.contains("text-warning")) return "Trial";
    if (td.classList.contains("text-danger")) return "Expired";
    return "Valid";
  }

  function parseTrialDays(s) {
    const m = s.match(TRIAL_RE);
    return m ? parseInt(m[1], 10) : null;
  }

  function parseKanban(card) {
    const link = card.querySelector("a.fw-bold, a.font-weight-bold");
    if (!link) return null;
    const name = link.textContent.trim();
    if (!name) return null;
    const url = link.getAttribute("href") || "/project/" + name;

    const rows = card.querySelectorAll("table tbody tr");
    const licenseTd = rows[0]?.querySelector("td");
    const stTd = rows[1]?.querySelector("td");
    const verTd = rows[2]?.querySelector("td");
    const locTd = rows[3]?.querySelector("td");
    const status = txt(stTd);
    const license = parseLicense(licenseTd);
    return {
      name, url: BASE + url, license, status,
      version: txt(verTd), location: txt(locTd),
      projectDaysLeft: license === "Trial" ? parseTrialDays(status) : null,
    };
  }

  function parseRow(row) {
    const name = row.getAttribute("data-name");
    if (!name) return null;
    const link = row.querySelector('a[href^="/project/"]');
    const url = link ? link.getAttribute("href") : "/project/" + name;
    const cells = row.querySelectorAll("td");
    const licTd = cells[0];
    const stTd = cells[1];
    const verTd = cells[2];
    const locTd = cells[3];
    const status = txt(stTd);
    const license = licTd ? parseLicense(licTd) : "Valid";
    return {
      name, url: BASE + url, license, status,
      version: txt(verTd), location: txt(locTd),
      projectDaysLeft: license === "Trial" ? parseTrialDays(status) : null,
    };
  }

  const cards = document.querySelectorAll("div.o_project_card_container");
  const rows = document.querySelectorAll("tr.o_project_card_container");
  const projects = [];

  if (cards.length > 0) {
    cards.forEach((c) => { const p = parseKanban(c); if (p) projects.push(p); });
  } else if (rows.length > 0) {
    rows.forEach((r) => { const p = parseRow(r); if (p) projects.push(p); });
  }

  return { projects };
}

function parseStagingBranchesFn() {
  const stageEl = document.querySelector('div.o_stage[data-stage="staging"]');
  if (!stageEl) return { branches: [] };
  let sibling = stageEl.nextElementSibling;
  while (sibling && sibling.tagName !== "UL") {
    sibling = sibling.nextElementSibling;
  }
  if (!sibling) return { branches: [] };
  const lis = sibling.querySelectorAll("li[data-branch-name]");
  return {
    branches: Array.from(lis)
      .map((li) => li.getAttribute("data-branch-name"))
      .filter(Boolean),
  };
}

function parseDeletionDateFn() {
  const DEL_RE = /will be deleted on (.+?)\./i;
  const DROPPED_RE = /was dropped on (.+?)\./i;
  const SPANISH_MONTHS = {
    "enero": 0, "febrero": 1, "marzo": 2, "abril": 3, "mayo": 4, "junio": 5,
    "julio": 6, "agosto": 7, "septiembre": 8, "setiembre": 8, "octubre": 9,
    "noviembre": 10, "diciembre": 11,
  };

  function parseDate(str) {
    str = str.trim();
    // Try English first: "9 August 2026"
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    // Try Spanish: "2 de marzo de 2026"
    const sm = str.match(/(\d+)\s+de\s+(\w+)\s+de\s+(\d+)/i);
    if (sm) {
      const day = parseInt(sm[1], 10);
      const month = SPANISH_MONTHS[sm[2].toLowerCase()];
      const year = parseInt(sm[3], 10);
      if (month !== undefined) {
        d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }
    }
    return null;
  }

  function txt(el) {
    return el ? el.textContent.trim() : "";
  }

  // Search in <p> and <strong> elements
  const els = document.querySelectorAll("p, strong");
  for (const el of els) {
    const text = txt(el);
    const delMatch = text.match(DEL_RE);
    if (delMatch) {
      const d = parseDate(delMatch[1]);
      if (d) return { deletionDate: d.toISOString(), dropped: false };
    }
    const droppedMatch = text.match(DROPPED_RE);
    if (droppedMatch) {
      const d = parseDate(droppedMatch[1]);
      if (d) return { deletionDate: d.toISOString(), dropped: true };
    }
  }
  return { deletionDate: null, dropped: false, strongCount: document.querySelectorAll("strong").length };
}

// ---------------------------------------------------------------------------
// Tab Helpers
// ---------------------------------------------------------------------------

function waitForTabLoad(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timeout waiting for tab to load"));
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutId);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

let _reusableTabId = null;

async function getReusableTab() {
  if (_reusableTabId) {
    try {
      await chrome.tabs.get(_reusableTabId);
      return _reusableTabId;
    } catch (_e) {
      _reusableTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  _reusableTabId = tab.id;
  return tab.id;
}

async function openTabAndParse(url, parseFn, { poll = false, maxWaitMs = 20000 } = {}) {
  const tabId = await getReusableTab();

  try {
    await chrome.tabs.update(tabId, { url });
    await waitForTabLoad(tabId);
    await new Promise((r) => setTimeout(r, 2000));

    if (!poll) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: parseFn,
      });
      return results?.[0]?.result || null;
    }

    // Polling mode: retry until result has meaningful data
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: parseFn,
      });
      const result = results?.[0]?.result;
      if (result) {
        if (Array.isArray(result.branches) && result.branches.length > 0) return result;
        if (result.deletionDate) return result;
        if (!Array.isArray(result.branches) && !("deletionDate" in result)) return result;
        if (result.strongCount > 5 && !result.deletionDate) return result;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Last attempt, return whatever we got
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: parseFn,
    });
    return results?.[0]?.result || null;
  } catch (e) {
    console.log(`[Odoo.sh Watcher] openTabAndParse error:`, e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Instance Building
// ---------------------------------------------------------------------------

function computeDaysRemaining(iso) {
  if (!iso) return Infinity;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function buildProjectInstance(p) {
  return {
    id: p.name, projectName: p.name, projectUrl: p.url,
    license: p.license, version: p.version, location: p.location,
    branchName: null, stage: "project", branchUrl: null,
    deletionDate: null,
    daysRemaining: p.license === "Expired" ? 0 : (p.projectDaysLeft ?? Infinity),
  };
}

function buildBranchInstance(p, branchName, deletionDateIso, dropped = false) {
  const daysRemaining = dropped
    ? -Math.ceil((Date.now() - new Date(deletionDateIso).getTime()) / 86400000)
    : computeDaysRemaining(deletionDateIso);
  return {
    id: `${p.name}/${branchName}`, projectName: p.name, projectUrl: p.url,
    license: dropped ? "Expired" : p.license, version: p.version, location: p.location,
    branchName, stage: "staging",
    branchUrl: `${ODOOSH_BASE_URL}/project/${p.name}/branches/${branchName}`,
    deletionDate: deletionDateIso,
    daysRemaining,
  };
}

// ---------------------------------------------------------------------------
// High-Level API
// ---------------------------------------------------------------------------

async function fetchAllInstances() {
  // Step 1: Find a tab on /project page, or create one
  const tabs = await chrome.tabs.query({ url: "https://www.odoo.sh/project" });

  let tabId;

  if (tabs.length > 0) {
    tabId = tabs[0].id;
  } else {
    const tab = await chrome.tabs.create({
      url: "https://www.odoo.sh/project",
      active: false,
    });
    tabId = tab.id;
    await waitForTabLoad(tabId);
    await new Promise((r) => setTimeout(r, 3000));
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: parseProjectListFn,
  });

  const projectResult = results?.[0]?.result;

  if (!projectResult || !projectResult.projects) {
    throw new Error("Failed to parse project list from Odoo.sh tab");
  }

  const projects = projectResult.projects;
  const instances = [];

  for (const project of projects) {
    instances.push(buildProjectInstance(project));

    if (project.license === "Expired") continue;

    // Parse staging branches from background tab
    let stagingBranchNames = [];
    try {
      const branchResult = await openTabAndParse(
        `${ODOOSH_BASE_URL}/project/${project.name}`,
        parseStagingBranchesFn,
        { poll: true, maxWaitMs: 30000 }
      );
      console.log(`[Odoo.sh Watcher] ${project.name} branches:`, branchResult?.branches?.length, JSON.stringify(branchResult));
      if (branchResult && branchResult.branches) {
        stagingBranchNames = branchResult.branches;
      }
    } catch (_e) {}

    // Parse deletion date from each staging branch page
    for (const branchName of stagingBranchNames) {
      try {
        const delResult = await openTabAndParse(
          `${ODOOSH_BASE_URL}/project/${project.name}/branches/${branchName}`,
          parseDeletionDateFn,
          { poll: true, maxWaitMs: 20000 }
        );
        console.log(`[Odoo.sh Watcher] ${project.name}/${branchName} deletion:`, JSON.stringify(delResult));
        if (delResult && delResult.deletionDate) {
          instances.push(buildBranchInstance(project, branchName, delResult.deletionDate, delResult.dropped));
        }
      } catch (_e) {}
      await new Promise((r) => setTimeout(r, BRANCH_FETCH_DELAY_MS));
    }
  }

  instances.sort((a, b) => {
    if (a.daysRemaining === Infinity) return 1;
    if (b.daysRemaining === Infinity) return -1;
    return a.daysRemaining - b.daysRemaining;
  });

  return instances;
}

export { fetchAllInstances };

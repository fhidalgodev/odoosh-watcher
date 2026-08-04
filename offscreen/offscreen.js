/**
 * Odoo.sh Watcher - Offscreen Document
 *
 * Runs in a DOM context so DOMParser is available.
 * Receives HTML strings from the service worker, parses them,
 * and returns structured data via chrome.runtime messaging.
 */

const ODOOSH_BASE_URL = "https://www.odoo.sh";
const DELETION_DATE_REGEX = /will be deleted on (.+?)\./i;
const TRIAL_DAYS_REGEX = /\((\d+)\s+days?\s+left\)/i;

function textOf(el) {
  return el ? el.textContent.trim() : "";
}

function parseHtmlString(html) {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

function parseLicense(td) {
  const text = textOf(td);
  if (text.toLowerCase().includes("trial")) return "Trial";
  if (text.toLowerCase().includes("expired")) return "Expired";
  if (td.classList.contains("text-warning")) return "Trial";
  if (td.classList.contains("text-danger")) return "Expired";
  return "Valid";
}

function parseTrialDaysLeft(status) {
  const match = status.match(TRIAL_DAYS_REGEX);
  return match ? parseInt(match[1], 10) : null;
}

function parseKanbanCard(card) {
  const name = card.getAttribute("data-name");
  if (!name) return null;

  const linkEl = card.querySelector("a.font-weight-bold");
  const url = linkEl ? linkEl.getAttribute("href") : `/project/${name}`;

  const rows = card.querySelectorAll("table tbody tr");
  const licenseTd = rows[0]?.querySelector("td");
  const statusTd = rows[1]?.querySelector("td");
  const versionTd = rows[2]?.querySelector("td");
  const locationTd = rows[3]?.querySelector("td");

  const status = textOf(statusTd);
  const license = parseLicense(licenseTd);

  return {
    name,
    url: `${ODOOSH_BASE_URL}${url}`,
    license,
    status,
    version: textOf(versionTd),
    location: textOf(locationTd),
    projectDaysLeft: license === "Trial" ? parseTrialDaysLeft(status) : null,
  };
}

function parseListRow(row) {
  const name = row.getAttribute("data-name");
  if (!name) return null;

  const linkEl = row.querySelector('a[href^="/project/"]');
  const url = linkEl ? linkEl.getAttribute("href") : `/project/${name}`;

  const cells = row.querySelectorAll("td");
  const licenseTd = cells[0];
  const statusTd = cells[1];
  const versionTd = cells[2];
  const locationTd = cells[3];

  const status = textOf(statusTd);
  const license = licenseTd ? parseLicense(licenseTd) : "Valid";

  return {
    name,
    url: `${ODOOSH_BASE_URL}${url}`,
    license,
    status,
    version: textOf(versionTd),
    location: textOf(locationTd),
    projectDaysLeft: license === "Trial" ? parseTrialDaysLeft(status) : null,
  };
}

function parseProjectList(html) {
  const doc = parseHtmlString(html);

  const kanbanCards = doc.querySelectorAll("div.o_project_card_container");
  const listRows = doc.querySelectorAll("tr.o_project_card_container");

  const projects = [];

  if (kanbanCards.length > 0) {
    kanbanCards.forEach((card) => {
      const project = parseKanbanCard(card);
      if (project) projects.push(project);
    });
  } else if (listRows.length > 0) {
    listRows.forEach((row) => {
      const project = parseListRow(row);
      if (project) projects.push(project);
    });
  }

  return projects;
}

function parseStagingBranches(html) {
  const doc = parseHtmlString(html);

  const stageEl = doc.querySelector('div.o_stage[data-stage="staging"]');
  if (!stageEl) return [];

  let sibling = stageEl.nextElementSibling;
  while (sibling) {
    if (sibling.tagName === "UL") {
      const branchLis = sibling.querySelectorAll("li.o_branch[data-branch-name]");
      return Array.from(branchLis)
        .map((li) => li.getAttribute("data-branch-name"))
        .filter(Boolean);
    }
    if (sibling.classList?.contains("o_stage")) break;
    sibling = sibling.nextElementSibling;
  }
  return [];
}

function parseDeletionDate(html) {
  const doc = parseHtmlString(html);

  const strongEls = doc.querySelectorAll("strong");
  for (const el of strongEls) {
    const text = textOf(el);
    const match = text.match(DELETION_DATE_REGEX);
    if (match) {
      const dateStr = match[1].trim();
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "parseHtml") {
    return false;
  }

  try {
    let result;
    switch (message.parseType) {
      case "projectList":
        result = parseProjectList(message.html);
        break;
      case "stagingBranches":
        result = parseStagingBranches(message.html);
        break;
      case "deletionDate":
        result = parseDeletionDate(message.html);
        break;
      default:
        sendResponse({ success: false, error: `Unknown parseType: ${message.parseType}` });
        return false;
    }
    sendResponse({ success: true, result });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
  return false;
});

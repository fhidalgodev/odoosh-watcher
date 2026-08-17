/**
 * Odoo.sh Watcher - Background Service Worker
 *
 * Runs periodically via chrome.alarms, fetches staging and production
 * instances from Odoo.sh, and sends native notifications when any
 * instance is close to its expiration date.
 */

import { fetchAllInstances } from "./lib/odoosh-api.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALARM_NAME = "odoosh-check";
const DEFAULT_CHECK_INTERVAL_MINUTES = 240; // 4 hours
const MIN_CHECK_INTERVAL_MINUTES = 30;
const MAX_CHECK_INTERVAL_MINUTES = 1440; // 24 hours
const DEFAULT_THRESHOLD_DAYS = 3;
const STORAGE_KEY_INSTANCES = "cached_instances";
const STORAGE_KEY_LAST_CHECK = "last_check";
const STORAGE_KEY_THRESHOLD = "threshold_days";
const STORAGE_KEY_CHECK_INTERVAL = "check_interval_minutes";

// ---------------------------------------------------------------------------
// Alarm Setup
// ---------------------------------------------------------------------------

/**
 * Create or refresh the periodic alarm using the configured interval.
 * Always clears and recreates the alarm so that interval changes take
 * effect immediately. Called on extension install/update, on service
 * worker startup, and when the user updates the interval from the popup.
 *
 * @returns {Promise<void>}
 */
async function setupAlarm() {
  const interval = await getCheckInterval();
  chrome.alarms.clear(ALARM_NAME, () => {
    chrome.alarms.create(ALARM_NAME, {
      periodInMinutes: interval,
    });
  });
}

// ---------------------------------------------------------------------------
// Core Logic
// ---------------------------------------------------------------------------

/**
 * Get the configured threshold (days before expiration to alert).
 * Reads from chrome.storage.sync, falls back to default.
 *
 * @returns {Promise<number>} Threshold in days
 */
async function getThreshold() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY_THRESHOLD], (result) => {
      resolve(result[STORAGE_KEY_THRESHOLD] ?? DEFAULT_THRESHOLD_DAYS);
    });
  });
}

/**
 * Get the configured check interval (minutes between periodic checks).
 * Reads from chrome.storage.sync, falls back to default.
 * Clamped to [MIN, MAX] to guard against corrupted values.
 *
 * @returns {Promise<number>} Interval in minutes
 */
async function getCheckInterval() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY_CHECK_INTERVAL], (result) => {
      const raw = result[STORAGE_KEY_CHECK_INTERVAL] ?? DEFAULT_CHECK_INTERVAL_MINUTES;
      const clamped = Math.min(
        Math.max(raw, MIN_CHECK_INTERVAL_MINUTES),
        MAX_CHECK_INTERVAL_MINUTES
      );
      resolve(clamped);
    });
  });
}

/**
 * Main check function. Fetches all instances, filters those close to
 * expiration, sends notifications, and caches results for the popup.
 */
async function checkOdooshInstances() {
  try {
    const instances = await fetchAllInstances();
    const threshold = await getThreshold();

    // Cache results for popup display
    await chrome.storage.local.set({
      [STORAGE_KEY_INSTANCES]: instances,
      [STORAGE_KEY_LAST_CHECK]: new Date().toISOString(),
    });

    // Filter instances that need alerts
    const alertable = instances.filter(
      (inst) =>
        inst.daysRemaining !== Infinity &&
        inst.daysRemaining <= threshold
    );

    // Send a notification for each alertable instance
    for (const inst of alertable) {
      sendExpirationNotification(inst);
    }

    // Send a summary notification if multiple instances are expiring
    if (alertable.length > 1) {
      sendSummaryNotification(alertable);
    }

    return { success: true, instances, alertable };
  } catch (error) {
    console.error("[Odoo.sh Watcher] Check failed:", error);
    return { success: false, error: error.message };
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Send a native notification for a single expiring instance.
 *
 * @param {Object} instance - ParsedInstance with daysRemaining <= threshold
 */
function sendExpirationNotification(instance) {
  const daysText = formatDaysRemaining(instance.daysRemaining);
  const isProject = instance.stage === "project";
  const stageLabel = isProject ? "Project Trial" : "Staging";
  const target = isProject
    ? instance.projectName
    : `${instance.projectName} / ${instance.branchName}`;

  chrome.notifications.create(`odoosh-${instance.id}`, {
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title: `Odoo.sh ${stageLabel} expiring soon`,
    message: `${target} ${daysText}.`,
    priority: 2,
    isClickable: true,
  });
}

/**
 * Send a summary notification when multiple instances are expiring.
 *
 * @param {Object[]} instances - Array of alertable instances
 */
function sendSummaryNotification(instances) {
  const stagingCount = instances.filter((i) => i.stage === "staging").length;
  const projectCount = instances.filter((i) => i.stage === "project").length;
  const parts = [];
  if (stagingCount) parts.push(`${stagingCount} staging`);
  if (projectCount) parts.push(`${projectCount} project trial`);

  chrome.notifications.create("odoosh-summary", {
    type: "basic",
    iconUrl: "icons/icon-48.png",
    title: "Odoo.sh - Multiple instances expiring",
    message: `${parts.join(" and ")} instance(s) are expiring soon. Click to review.`,
    priority: 2,
    isClickable: true,
  });
}

/**
 * Format days remaining into a human-readable string.
 *
 * @param {number} days - Days remaining (can be negative if expired)
 * @returns {string} Formatted text
 */
function formatDaysRemaining(days) {
  if (days < 0) {
    return `expired ${Math.abs(days)} day(s) ago`;
  }
  if (days === 0) {
    return "expires today";
  }
  if (days === 1) {
    return "expires in 1 day";
  }
  return `expires in ${days} days`;
}

// ---------------------------------------------------------------------------
// Event Listeners
// ---------------------------------------------------------------------------

// Extension installed/updated
chrome.runtime.onInstalled.addListener(() => {
  setupAlarm().catch((e) => console.error("[Odoo.sh Watcher] setupAlarm failed:", e));
  // Run an initial check shortly after install
  setTimeout(checkOdooshInstances, 5000);
});

// Alarm fires
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkOdooshInstances();
  }
});

// Message from popup (force check)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "force-check") {
    checkOdooshInstances().then((result) => {
      sendResponse(result);
    });
    return true; // Keep the message channel open for async response
  }

  if (message.action === "get-cached") {
    chrome.storage.local.get(
      [STORAGE_KEY_INSTANCES, STORAGE_KEY_LAST_CHECK],
      (result) => {
        sendResponse({
          instances: result[STORAGE_KEY_INSTANCES] || [],
          lastCheck: result[STORAGE_KEY_LAST_CHECK] || null,
        });
      }
    );
    return true;
  }

  if (message.action === "update-interval") {
    setupAlarm().then(
      () => sendResponse({ success: true }),
      (err) => sendResponse({ success: false, error: err.message })
    );
    return true;
  }
});

// Notification clicked - open the branch URL
chrome.notifications.onClicked.addListener((notificationId) => {
  // Extract instance ID from notification ID (format: "odoosh-{id}")
  const instanceId = notificationId.replace("odoosh-", "");

  if (instanceId === "summary") {
    // Open the Odoo.sh dashboard
    chrome.tabs.create({ url: "https://www.odoo.sh" });
    return;
  }

  // Look up the instance URL from cache
  chrome.storage.local.get([STORAGE_KEY_INSTANCES], (result) => {
    const instances = result[STORAGE_KEY_INSTANCES] || [];
    const instance = instances.find((i) => String(i.id) === instanceId);
    if (instance) {
      const url = instance.branchUrl || instance.projectUrl || "https://www.odoo.sh";
      chrome.tabs.create({ url });
    } else {
      chrome.tabs.create({ url: "https://www.odoo.sh" });
    }
  });
});

// Ensure alarm exists when service worker wakes up
setupAlarm().catch((e) => console.error("[Odoo.sh Watcher] setupAlarm failed:", e));

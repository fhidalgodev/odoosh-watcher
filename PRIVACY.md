# Privacy Policy - Odoo.sh Watcher

**Last updated: August 17, 2026**

## Overview

Odoo.sh Watcher ("the Extension") is a browser extension that monitors your Odoo.sh staging and project trial instances and notifies you when they are approaching expiration or deletion.

## Data Collection

The Extension reads the following data from Odoo.sh pages you have access to:

- **Project names** from your Odoo.sh dashboard
- **Branch names** from your Odoo.sh project pages
- **License status** (Trial, Expired, Valid)
- **Trial days remaining** for project trials
- **Deletion dates** for staging branches
- **Version and location** information of your Odoo.sh instances

This data is read directly from the DOM of Odoo.sh pages already rendered in your browser. The Extension does **not** make any API calls to Odoo.sh or any third-party service.

## Data Storage

All data is stored locally in your browser using Chrome's storage APIs:

- **`chrome.storage.sync`**: Stores your user preferences (expiration threshold in days, check interval in minutes).
- **`chrome.storage.local`**: Caches the latest instance data and the timestamp of the last check, so the popup UI can display results without re-fetching.

No data is transmitted to, stored on, or processed by any external server. All data remains on your device.

## Data Sharing

The Extension does **not** share, sell, rent, or transmit any data to any third party. There are no analytics, no telemetry, and no external communications.

## Data Security

Since all data is stored locally in your browser and never transmitted externally, the risk of data interception is minimal. Uninstalling the Extension removes all stored data.

## Permissions Justification

| Permission | Purpose |
|---|---|
| `alarms` | Schedule periodic background checks of Odoo.sh instances |
| `notifications` | Display native alerts when instances are expiring |
| `storage` | Persist user preferences and cached instance data locally |
| `offscreen` | Provide a DOM environment for parsing HTML strings |
| `tabs` | Find existing Odoo.sh tabs and open background tabs for parsing |
| `scripting` | Inject DOM parsing functions into Odoo.sh pages |
| `*://*.odoo.sh/*` | Access Odoo.sh pages to read instance data |

## Third-Party Services

The Extension does **not** use any third-party services, analytics, advertising, or tracking libraries.

## Children's Privacy

The Extension is not directed at children under 13 and does not knowingly collect any data from children.

## Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be posted in this file with an updated date.

## Contact

For questions about this Privacy Policy, please contact:

- **Email:** fhidalgo.dev@gmail.com
- **GitHub:** https://github.com/fhidalgodev

## Consent

By installing and using the Extension, you consent to this Privacy Policy.

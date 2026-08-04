# Odoo.sh Watcher

Browser extension (Chrome/Edge/Brave) that monitors Odoo.sh projects and staging branches, sending native desktop notifications when they are close to expiration. Made by Franyer Hidalgo (github.com/fhidalgodev).

## Features

- **Automatic monitoring** every 4 hours via `chrome.alarms`
- **Native notifications** when instances expire within the configured threshold (default: 3 days)
- **Popup UI** with Odoo Purple theme showing:
  - **Tabbed interface** with "Expiring" and "Expired" tabs, each with live count badges
  - Projects grouped with license badges (Valid/Trial/Expired) and Odoo version
  - Staging branches with deletion date countdown
  - Trial projects with days remaining countdown
  - Color-coded indicators (green > 7d, yellow 3-7d, red < 3d)
  - Configurable alert threshold (1-30 days)
  - **Language selector** (English/Espanol) with live switching — no restart needed
  - "Force Check Now" button for manual refresh
- **Session-based auth** - inherits cookies from your logged-in Odoo.sh session (no API keys needed)
- **Click-to-open** - clicking a notification opens the branch or project dashboard
- **SPA-aware scraping** - uses `chrome.tabs` + `chrome.scripting.executeScript` with polling to handle Odoo.sh's async rendering
- **Bilingual date parsing** - detects deletion dates in both English and Spanish formats
- **Dropped branch detection** - branches with "was dropped on DATE" are marked as expired

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome/Edge/Brave and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `odoosh-watcher` folder
5. The extension icon should appear in your toolbar
6. Make sure you are logged in to [www.odoo.sh](https://www.odoo.sh) in your browser

## Usage

1. **Automatic**: The extension checks every 4 hours in the background. If any staging or production instance is within the threshold, you will receive a desktop notification.
2. **Manual**: Click the extension icon and press "Force Check Now" to run an immediate check.
3. **Configure**: Adjust the "Alert me X days before expiration" setting in the popup and click "Save Settings".
4. **Language**: Select English or Espanol from the language dropdown in Settings. The UI updates instantly.

## Architecture

```
odoosh-watcher/
├── manifest.json          # Manifest V3 configuration
├── background.js          # Service worker: alarms, notifications, core logic
├── lib/
│   └── odoosh-api.js      # Scraping logic: projects, branches, deletion dates
├── popup/
│   ├── popup.html         # Popup UI with tabbed interface
│   ├── popup.css          # Odoo Purple theme styles
│   └── popup.js           # Popup logic, i18n, background communication
├── _locales/
│   ├── en/messages.json   # English translations
│   └── es/messages.json   # Spanish translations
├── offscreen/
│   └── offscreen.html     # Offscreen document for notifications
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
└── README.md
```

### How It Works

1. **Background Service Worker** (`background.js`):
   - Creates a `chrome.alarms` timer that fires every 4 hours
   - On each tick, calls `fetchAllInstances()` from the API module
   - Compares each instance's `daysRemaining` against the configured threshold
   - If `daysRemaining <= threshold`, sends a `chrome.notifications.create()` notification
   - Caches results in `chrome.storage.local` for the popup to read

2. **API Module** (`lib/odoosh-api.js`):
   - **Level 1**: Scrapes `/project` to extract the project list (name, license, version, location, trial days left)
   - **Level 2**: For each non-expired project, opens `/project/{name}` and parses staging branches by locating `div.o_stage[data-stage="staging"]` and its sibling `<ul>` to find `li[data-branch-name]` elements
   - **Level 3**: For each staging branch, navigates to `/project/{name}/branches/{branch}` and parses the deletion date from `<strong>` and `<p>` elements using regex patterns for both English ("will be deleted on") and Spanish date formats, plus dropped builds ("was dropped on")
   - Uses a **reusable background tab** to avoid Chrome's tab throttling — navigates the same tab to each URL instead of creating new ones
   - **Polling with retries** (up to 30s) handles SPA async rendering, waiting until branch elements or deletion dates appear
   - Only branches with a `deletionDate` are added as instances (production/dev branches without expiration are skipped)
   - Returns normalized `ParsedInstance` objects sorted by `daysRemaining`

3. **Popup** (`popup/popup.html` + `popup.js`):
   - Reads cached data from `chrome.storage.local`
   - Splits instances into "Expiring" (daysRemaining >= 0) and "Expired" (daysRemaining < 0 or license expired) tabs
   - Groups instances by project with license badges and version display
   - **i18n system** loads translations from `_locales/{locale}/messages.json` via `fetch()` at runtime
   - Language preference saved to `chrome.storage.sync` — defaults to browser locale
   - Sends messages to the background service worker for force-checks
   - Saves threshold configuration to `chrome.storage.sync`

## Important Notes

### Scraping Approach

The extension scrapes HTML pages directly from [www.odoo.sh](https://www.odoo.sh) since no public REST API exists for project/branch data. The scraping logic targets:

- **Project list**: `div.o_project_card_container` (kanban) or `tr.o_project_card_container` (list view) on `/project`
- **Staging branches**: `div.o_stage[data-stage="staging"]` sibling `<ul>` -> `li[data-branch-name]` on `/project/{name}`
- **Deletion date**: `<strong>` and `<p>` text matching `/will be deleted on (.+?)\./i` (English) or Spanish date patterns in branch build history
- **Dropped builds**: `/was dropped on (.+?)\./i` marks branches as expired

If Odoo.sh changes its HTML structure, the CSS selectors in `lib/odoosh-api.js` will need to be updated accordingly.

### Authentication

The extension relies on the browser's existing session cookies for Odoo.sh. No API keys or tokens are required. The reusable background tab inherits the browser's session automatically.

### Permissions

| Permission | Purpose |
|---|---|
| `alarms` | Schedule periodic checks every 4 hours |
| `notifications` | Send desktop notifications for expiring instances |
| `storage` | Cache instance data and save user settings (threshold, locale) |
| `tabs` | Create and navigate reusable background tab for scraping |
| `scripting` | Execute parsing functions in background tab via `executeScript` |
| `offscreen` | Offscreen documents for notification handling |
| `host_permissions: *://*.odoo.sh/*` | Allow scraping of Odoo.sh pages |
| `web_accessible_resources` | Allow popup to fetch `_locales/*/messages.json` for i18n |

## Browser Compatibility

- Chrome 88+ (Manifest V3 support)
- Edge 88+
- Brave 1.20+
- Any Chromium-based browser with Manifest V3 support

## Author

**Franyer Hidalgo**

- Email: [fhidalgo.dev@gmail.com](mailto:fhidalgo.dev@gmail.com)
- GitHub: [https://github.com/fhidalgodev](https://github.com/fhidalgodev)
- LinkedIn: [https://www.linkedin.com/in/fhidalgodev/](https://www.linkedin.com/in/fhidalgodev/)

## License

MIT (c) Franyer Hidalgo

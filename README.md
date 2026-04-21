# Ethos Dashboard

A React + TypeScript dashboard for analyzing Varian Ethos machine data, including:

- **MLC faults** from COL EventLog XML files
- **Other machine events** from non-COL EventLog XML files
- **Combined TXT logs** (fault + generic event extraction)
- **Motor replacement records** from Excel/manual input
- **Folder-based scanning and desktop auto-scan** workflows

This repository contains the web app and Tauri desktop integration glue used for local filesystem access.

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [Project structure](#project-structure)
3. [How data flows through the app](#how-data-flows-through-the-app)
4. [Features by page](#features-by-page)
5. [Input formats supported](#input-formats-supported)
6. [Configuration](#configuration)
7. [Run locally](#run-locally)
8. [Desktop (Tauri) notes](#desktop-tauri-notes)
9. [Build and checks](#build-and-checks)
10. [Troubleshooting](#troubleshooting)

---

## Tech stack

- **Frontend:** React 18, TypeScript, Vite
- **UI:** shadcn/ui, Radix UI, Tailwind CSS
- **Charts:** Recharts
- **Data parsing:** DOMParser + custom parsers for XML/TXT
- **File handling:** JSZip, xlsx, file-saver
- **Desktop integration:** Tauri v2 bridge wrappers

---

## Project structure

```text
src/
  App.tsx                     # App providers + router
  main.tsx                    # React bootstrap

  pages/                      # Route-level pages
    UploadPage.tsx
    AllFaultsPage.tsx
    MLCPage.tsx
    OtherEventsPage.tsx
    ChartsPage.tsx
    ConfigurationPage.tsx
    AutoScanDiagnosticsPage.tsx

  contexts/                   # Cross-cutting app state
    AppConfigContext.tsx      # Configuration + import/export
    DashboardContext.tsx      # Selected machine/date + filtered data
    UploadContext.tsx         # Folder scan/watch + parse + callbacks
    ThemeContext.tsx

  hooks/
    useMachineData.ts         # MLC errors/replacements persistence & grouping
    useEventLogData.ts        # Generic events persistence

  lib/
    xmlLogParser.ts           # COL EventLog XML -> MLCError[]
    genericEventParser.ts     # EventLog XML -> GenericEvent[]
    combinedLogParser.ts      # Combined TXT -> { mlcErrors, genericEvents }
    statisticsCharts.ts       # Series extraction/aggregation helpers
    tauriBridge.ts            # Tauri invoke wrappers

  data/
    mlcErrorData.ts           # MLC domain model + merge/group utilities
    genericEventData.ts       # Generic event domain model + merge utilities
    eventLogTypes.ts          # Event type detection + labels/colors
    componentSubsystems.ts    # Component -> subsystem mapping

  components/
    ...                       # Feature components and UI primitives
```

---

## How data flows through the app

1. **Data ingestion** (Upload page / folder scanner / desktop auto-scan)
2. **Parser layer** converts raw XML/TXT into domain objects:
   - `MLCError[]`
   - `GenericEvent[]`
3. **Persistence layer** stores normalized data in localStorage
4. **Dashboard context** applies selected machine/date filters
5. **Pages/components** render tables, timelines, stats, and charts

High-level ownership:

- `UploadContext`: discover and parse files
- `useMachineData`: raw+processed MLC errors and replacements
- `useEventLogData`: event logs by machine + type
- `DashboardContext`: filtered projections for UI pages

---

## Features by page

### Upload

- Uploads ZIP/XML/TXT inputs
- Folder scan + watch mode in browser environments
- Desktop auto-scan integration (Tauri runtime)
- Import summary for machine/event counts

### All Faults

- Combined overview of MLC + non-MLC fault activity
- KPI cards and timelines
- Event subsystem aggregation

### MLC

- MLC-focused diagnostics (tables/heatmaps/trends)
- Motor replacement-aware visualizations

### Other Events

- Non-MLC event browsing by type
- Correlated event grouping/time-window inspection

### Charts

- Statistics-series extraction from `logStatistics` messages
- Daily aggregation options and y-axis scaling
- Magnetron arc count series extraction

### Configuration

- Hospital name, machine IDs, excluded terms
- Chart display labels/units/visibility
- Combined log processor settings (filters/paths)
- Config import/export

### AutoScan Diagnostics

- Desktop scan execution diagnostics and restore reporting

---

## Input formats supported

### 1) COL EventLog XML

Used to generate MLC errors.

Typical filename pattern includes:

- `_COLEventLog.xml`

### 2) Other EventLog XML

Used to generate generic events (MLC/Motion/Beam/Image/Other types).

### 3) Combined TXT logs

Tab-delimited rows from Ethos combined logs.

- Early tab-column filters may be applied
- Rows can become either MLC errors or generic events

### 4) Backup JSON

Used for restoring previously exported dashboard data.

### 5) Excel files

Used for replacement imports and other upload workflows.

---

## Configuration

The app persists most configuration and datasets in localStorage.

Primary keys include:

- `ethos-dashboard-config`
- `ethos-combined-log-processor-config`
- `mlc-dashboard-data-v2`
- `mlc-dashboard-events`

Config can also be imported/exported from the Configuration page.

### Combined Log Config: Legacy vs Advanced (v2)

- **Legacy mode** keeps the existing `filters` + `conditionalFilters` JSON layout.
- **Advanced (v2) mode** writes only the new v2 filter policy keys:
  - `filterPolicyVersion: 2`
  - `defaultAction`
  - `resolutionStrategy` (`firstMatch` or `includeOverridesExclude`)
  - `rules`
- In `includeOverridesExclude`, hard excludes win, otherwise includes win over normal excludes.
- Base processor settings (such as `inputs`, `archiveDir`, `outputDir`, and `machineIds`) are preserved in both modes.
- When importing config:
  - If `filterPolicyVersion` is `2`, the UI opens in Advanced mode.
  - Otherwise, the UI opens in Legacy mode.

---

## Run locally

### Requirements

- Node.js 18+ recommended
- npm (or compatible package manager)

### Install

```bash
npm install
```

### Start dev server

```bash
npm run dev
```

Default Vite dev port in this project is configured as **8080**.

---

## Desktop (Tauri) notes

This repository includes Tauri bridge support (path/fs plugins).

Useful commands:

```bash
npm run tauri:dev
npm run tauri:build
```

For capability configuration guidance, see:

- `docs/tauri-v2-setup.md`
- `docs/tauri-v2-capabilities.default.json`

---

## Build and checks

```bash
npm run lint
npm run build
npm run preview
```

---

## Troubleshooting

### `vite: not found`

Install dependencies first:

```bash
npm install
```

### ESLint module resolution errors

If packages like `@eslint/js` cannot be found, ensure dependencies are installed and lockfile/tooling are consistent.

### No data appears after upload

- Verify file type is supported (ZIP/XML/TXT/backup JSON)
- Check machine IDs in Configuration
- Confirm date-range filters include imported timestamps

### Desktop auto-scan not running

- Verify Tauri runtime is active
- Check capability permissions in `src-tauri/capabilities/default.json`
- Validate configured directory paths

---

## Notes

- This dashboard is designed for operational diagnostics and trend analysis.
- It does not replace vendor service procedures or clinical safety processes.

export type AppPageSection = 'views' | 'settings';

export type AppPageKey =
  | 'home'
  | 'overview'
  | 'allFaults'
  | 'mlc'
  | 'charts'
  | 'comparison'
  | 'healthReport'
  | 'configuration'
  | 'combinedLogConfig'
  | 'dataManagement'
  | 'autoScanDiagnostics';

export interface AppPageDefinition {
  key: AppPageKey;
  title: string;
  path: string;
  section: AppPageSection;
  hideable: boolean;
}

export const APP_PAGES: AppPageDefinition[] = [
  { key: 'home', title: 'Home', path: '/', section: 'views', hideable: true },
  { key: 'overview', title: 'Overview', path: '/all-faults', section: 'views', hideable: true },
  { key: 'allFaults', title: 'All Faults', path: '/other', section: 'views', hideable: true },
  { key: 'mlc', title: 'MLC', path: '/mlc', section: 'views', hideable: true },
  { key: 'charts', title: 'Charts', path: '/charts', section: 'views', hideable: true },
  { key: 'comparison', title: 'Comparison', path: '/comparison', section: 'views', hideable: true },
  { key: 'healthReport', title: 'Health report', path: '/health-report', section: 'views', hideable: true },
  { key: 'configuration', title: 'Configuration', path: '/configuration', section: 'settings', hideable: false },
  { key: 'combinedLogConfig', title: 'Combined Log Config', path: '/combined-log-config', section: 'settings', hideable: true },
  { key: 'dataManagement', title: 'Data management', path: '/upload', section: 'settings', hideable: true },
  { key: 'autoScanDiagnostics', title: 'Auto-scan diagnostics', path: '/autoscan-diagnostics', section: 'settings', hideable: true },
];

export const DEFAULT_PAGE_VISIBILITY: Record<AppPageKey, boolean> = APP_PAGES.reduce(
  (acc, page) => ({ ...acc, [page.key]: true }),
  {} as Record<AppPageKey, boolean>,
);

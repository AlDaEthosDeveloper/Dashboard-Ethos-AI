import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Cpu,
  AlertTriangle,
  LineChart,
  Database,
  House,
  Leaf,
  Settings,
  TestTube,
  ChevronDown,
  Moon,
  Sun,
  FileCog,
  FileText,
  Clock3,
  ExternalLink,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import { useDashboard } from '@/contexts/DashboardContext';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useUpload } from '@/contexts/UploadContext';
import { APP_PAGES } from '@/lib/pageRegistry';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
} from '@/components/ui/sidebar';

/**
 * Executes `AppSidebar`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedMachine, setSelectedMachine, machineLastRunStatusByMachine } = useDashboard();
  const { config, getMachineLabel } = useAppConfig();
  const { theme, setTheme } = useTheme();
  const { desktopAutoScanReport } = useUpload();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const showStaleAutoScanClock = useMemo(() => {
    if (!desktopAutoScanReport) return false;
    const staleThresholdMs = Math.max(1, config.autoScanOverdueMinutes) * 60 * 1000;

    const ranAtMs = new Date(desktopAutoScanReport.ranAt).getTime();
    const latestJsonModifiedAtMs = desktopAutoScanReport.latestJsonModifiedAt
      ? new Date(desktopAutoScanReport.latestJsonModifiedAt).getTime()
      : null;

    const isRunTimeStale = Number.isFinite(ranAtMs) ? nowMs - ranAtMs > staleThresholdMs : false;
    const isJsonModifiedStale =
      latestJsonModifiedAtMs !== null && Number.isFinite(latestJsonModifiedAtMs)
        ? nowMs - latestJsonModifiedAtMs > staleThresholdMs
        : false;

    return isRunTimeStale || isJsonModifiedStale;
  }, [config.autoScanOverdueMinutes, desktopAutoScanReport, nowMs]);

  const showStaleMachineLastRunClock = useMemo(() => {
    const staleThresholdMs = Math.max(1, config.machineLastRunOverdueMinutes) * 60 * 1000;
    return Object.values(machineLastRunStatusByMachine).some((status) => {
      if (!status.timestamp) return false;
      const parsedMs = new Date(status.timestamp.replace(' ', 'T')).getTime();
      return Number.isFinite(parsedMs) && nowMs - parsedMs > staleThresholdMs;
    });
  }, [config.machineLastRunOverdueMinutes, machineLastRunStatusByMachine, nowMs]);

  const showAnyClockAlert = showStaleAutoScanClock || showStaleMachineLastRunClock;
  
  const iconByPath: Record<string, typeof House> = {
    '/': House,
    '/all-faults': House,
    '/other': AlertTriangle,
    '/mlc': Leaf,
    '/charts': LineChart,
    '/comparison': LineChart,
    '/health-report': FileText,
    '/configuration': Settings,
    '/combined-log-config': FileCog,
    '/upload': Database,
    '/autoscan-diagnostics': TestTube,
  };

  const viewItems = APP_PAGES
    .filter((page) => page.section === 'views' && config.pageVisibility[page.key] !== false)
    .map((page) => ({ title: page.title, url: page.path, icon: iconByPath[page.path] || House }));

  const dataItems = APP_PAGES
    .filter((page) => page.section === 'settings' && config.pageVisibility[page.key] !== false)
    .map((page) => ({ title: page.title, url: page.path, icon: iconByPath[page.path] || Settings }));
  
  return (
    <Sidebar collapsible="none">
      <SidebarHeader className="border-b border-border p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold text-foreground">{config.hospitalName}</h1>
            {config.devModeEnabled ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">DEV</span> : null}
          </div>
        </div>
      </SidebarHeader>
      
      <SidebarContent>
        {/* Views Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {viewItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink 
                      to={item.url} 
                      className="hover:bg-muted/50 flex items-center gap-2" 
                      activeClassName="bg-muted text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Machine Selection */}
        <SidebarGroup>
          <SidebarGroupLabel>Machine</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {config.machineIds.map((id) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton 
                    onClick={() => { setSelectedMachine(id); navigate(`${location.pathname}${location.search}`); }}
                    className={`hover:bg-muted/50 ${selectedMachine === id ? 'bg-muted text-primary font-medium' : ''}`}
                  >
                    <Activity className="h-4 w-4" />
                    <span>{getMachineLabel(id)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Data Section - collapsible, collapsed by default */}
        <Collapsible defaultOpen={false}>
          <SidebarGroup>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="cursor-pointer hover:bg-muted/50 flex items-center justify-between">
                Settings
                <div className="flex items-center gap-1">
                  {showAnyClockAlert ? <Clock3 className="h-3.5 w-3.5 text-destructive" aria-label="Diagnostics alert" /> : null}
                  <ChevronDown className="h-3 w-3 transition-transform [[data-state=closed]_&]:rotate-[-90deg]" />
                </div>
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {showAnyClockAlert && config.pageVisibility.autoScanDiagnostics !== false ? (
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to="/autoscan-diagnostics"
                          className="hover:bg-muted/50 flex items-center gap-2 text-destructive"
                          activeClassName="bg-muted text-primary font-medium"
                        >
                          <Clock3 className="h-4 w-4" />
                          <span>Diagnostics alert</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : null}
                  {dataItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink 
                          to={item.url} 
                          className="hover:bg-muted/50 flex items-center gap-2" 
                          activeClassName="bg-muted text-primary font-medium"
                        >
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>

      </SidebarContent>
      <SidebarFooter className="border-t border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Theme</span>
          <div className="flex items-center gap-2">
            <Sun className="h-4 w-4 text-muted-foreground" />
            <Switch
              checked={theme === 'dark'}
              onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              aria-label="Toggle dark mode"
            />
            <Moon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

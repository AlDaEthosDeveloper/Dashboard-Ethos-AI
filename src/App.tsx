import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppConfigProvider } from "@/contexts/AppConfigContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import UploadPage from "@/pages/UploadPage";
import AllFaultsPage from "@/pages/AllFaultsPage";
import MLCPage from "@/pages/MLCPage";
import OtherEventsPage from "@/pages/OtherEventsPage";
import ChartsPage from "@/pages/ChartsPage";
import LandingPage from "@/pages/LandingPage";
import ComparisonPage from "@/pages/ComparisonPage";
import MachineHealthReportPage from "@/pages/MachineHealthReportPage";
import ConfigurationPage from "@/pages/ConfigurationPage";
import CombinedLogConfigPage from "@/pages/CombinedLogConfigPage";
import AutoScanDiagnosticsPage from "@/pages/AutoScanDiagnosticsPage";
import { DataAccessGuard } from "@/components/DataAccessGuard";
import { PageVisibilityGuard } from "@/components/PageVisibilityGuard";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * Executes `App`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <AppConfigProvider>
        <BrowserRouter>
          <Routes>
            <Route
              path="/"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="home">
                    <LandingPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/upload"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="dataManagement">
                    <DataAccessGuard>
                      <UploadPage />
                    </DataAccessGuard>
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/all-faults"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="overview">
                    <AllFaultsPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/mlc"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="mlc">
                    <MLCPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/other"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="allFaults">
                    <OtherEventsPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/charts"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="charts">
                    <ChartsPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/comparison"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="comparison">
                    <ComparisonPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/health-report"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="healthReport">
                    <MachineHealthReportPage />
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/autoscan-diagnostics"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="autoScanDiagnostics">
                    <DataAccessGuard>
                      <AutoScanDiagnosticsPage />
                    </DataAccessGuard>
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/configuration"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="configuration">
                    <DataAccessGuard>
                      <ConfigurationPage />
                    </DataAccessGuard>
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            <Route
              path="/combined-log-config"
              element={
                <DashboardLayout>
                  <PageVisibilityGuard pageKey="combinedLogConfig">
                    <DataAccessGuard>
                      <CombinedLogConfigPage />
                    </DataAccessGuard>
                  </PageVisibilityGuard>
                </DashboardLayout>
              }
            />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AppConfigProvider>
    </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;

import { ReactNode } from 'react';
import { Cpu } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { DashboardProvider, useDashboard } from '@/contexts/DashboardContext';
import { UploadProvider } from '@/contexts/UploadContext';
import { AICopilotPanel } from '@/components/AICopilotPanel';

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Executes `DashboardContent`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const DashboardContent = ({ children }: DashboardLayoutProps) => {
  return (
    <SidebarProvider>
      <div className="h-screen flex w-full overflow-hidden">
        <AppSidebar />
        <main className="flex-1 flex flex-col overflow-y-auto">
          <div className="flex-1 p-6">
            {children}
          </div>
          <AICopilotPanel />
        </main>
      </div>
    </SidebarProvider>
  );
};

/**
 * Executes `LoadingState`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const LoadingState = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="text-center">
      <Cpu className="w-12 h-12 text-primary animate-pulse mx-auto mb-4" />
      <p className="text-muted-foreground">Loading dashboard...</p>
    </div>
  </div>
);

/**
 * Executes `DashboardLayout`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const DashboardLayout = ({ children }: DashboardLayoutProps) => {
  return (
    <UploadProvider>
      <DashboardProvider>
        <DashboardLayoutWrapper>{children}</DashboardLayoutWrapper>
      </DashboardProvider>
    </UploadProvider>
  );
};

/**
 * Executes `DashboardLayoutWrapper`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const DashboardLayoutWrapper = ({ children }: DashboardLayoutProps) => {
  try {
    useDashboard();
    return <DashboardContent>{children}</DashboardContent>;
  } catch {
    return <LoadingState />;
  }
};

export default DashboardLayout;

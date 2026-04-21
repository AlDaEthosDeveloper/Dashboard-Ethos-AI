import { useMemo } from 'react';
import { Cpu } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useDashboard } from '@/contexts/DashboardContext';
import { DateRangeStatusBar } from '@/components/DateRangeStatusBar';
import { EventLogTabs } from '@/components/EventLogTabs';
import { EVENT_LOG_TYPES } from '@/data/eventLogTypes';
import { SubsystemType } from '@/data/componentSubsystems';
import { useAppConfig } from '@/contexts/AppConfigContext';

/**
 * Executes `OtherEventsPage`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const OtherEventsPage = () => {
  const [searchParams] = useSearchParams();
  const initialSubsystem = searchParams.get('subsystem') as SubsystemType | null;
  
  const { getMachineLabel } = useAppConfig();
  const { 
    selectedMachine,
    filteredEvents,
    filteredErrors,
    dateRange,
    setDateRange,
    clearEventData,
  } = useDashboard();
  
  const faultEvents = useMemo(() => filteredEvents, [filteredEvents]);
  const selectedMachineLabel = getMachineLabel(selectedMachine);

  const totalOtherEvents = EVENT_LOG_TYPES
    .reduce((sum, type) => sum + (faultEvents[type]?.length || 0), 0);
  
  return (
    <div className="space-y-6 w-full min-w-0">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-foreground">All Events for {selectedMachineLabel}</h2>
        </div>
        <DateRangeStatusBar />
      </div>
      
      {totalOtherEvents === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Cpu className="w-16 h-16 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Other Events for {selectedMachineLabel}</h3>
          <p className="text-muted-foreground max-w-md">
            Upload log files via the Upload page to see non-MLC events here.
          </p>
        </div>
      ) : (
        <EventLogTabs 
          eventsByType={faultEvents} 
          mlcErrors={filteredErrors}
          onClearEvents={(logType) => clearEventData(selectedMachine, logType)} 
          correlatedEventIds={new Set()}
          initialSubsystem={initialSubsystem || undefined}
        />
      )}
    </div>
  );
};

export default OtherEventsPage;

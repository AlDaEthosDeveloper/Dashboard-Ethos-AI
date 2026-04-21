import { Cpu } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MachineTab } from '@/components/MachineTab';
import { ReplacementExcelUpload } from '@/components/ReplacementExcelUpload';
import { FolderScanner } from '@/components/FolderScanner';
import { useMachineData } from '@/hooks/useMachineData';
import { useEventLogData } from '@/hooks/useEventLogData';
import { MACHINE_IDS, MachineId } from '@/data/mlcErrorData';
import { EventLogType } from '@/data/eventLogTypes';

/**
 * Executes `Index`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const Index = () => {
  const { 
    machineData, 
    isLoaded, 
    addErrors, 
    addReplacement,
    addReplacements, 
    removeReplacement, 
    clearMachineData,
    groupingWindowSeconds,
    setGroupingWindowSeconds,
    getRawErrors,
  } = useMachineData();

  const {
    eventData,
    isLoaded: eventsLoaded,
    addEvents,
    clearEventData,
    getEventsByType,
  } = useEventLogData();

  if (!isLoaded || !eventsLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Cpu className="w-12 h-12 text-primary animate-pulse mx-auto mb-4" />
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Cpu className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">MLC Error Dashboard</h1>
                <p className="text-sm text-muted-foreground">Varian Ethos • UMC St. Radboud</p>
              </div>
            </div>
            <ReplacementExcelUpload onReplacementsLoaded={addReplacements} />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-6 space-y-6">
        {/* Folder Scanner */}
        <FolderScanner 
          onDataLoaded={addErrors} 
          onEventsLoaded={(machineId: MachineId, logType: EventLogType, events) => addEvents(machineId, logType, events)}
          onReplacementsLoaded={addReplacements}
        />
        
        <Tabs defaultValue="HAL2106" className="space-y-6">
          <TabsList className="grid w-full max-w-md grid-cols-3">
            {MACHINE_IDS.map(id => (
              <TabsTrigger key={id} value={id} className="gap-2">
                {id}
                {machineData[id].errors.length > 0 && (
                  <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                    {machineData[id].errors.length}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {MACHINE_IDS.map(id => (
            <TabsContent key={id} value={id}>
              <MachineTab
                machineId={id}
                errors={machineData[id].errors}
                rawErrors={getRawErrors(id)}
                replacements={machineData[id].replacements}
                eventsByType={getEventsByType(id)}
                onAddErrors={(errors) => addErrors(id, errors)}
                onAddReplacement={(replacement) => addReplacement(id, replacement)}
                onRemoveReplacement={(replacementId) => removeReplacement(id, replacementId)}
                onClearData={() => clearMachineData(id)}
                onClearEvents={(logType) => clearEventData(id, logType)}
                groupingWindowSeconds={groupingWindowSeconds}
                onGroupingWindowChange={setGroupingWindowSeconds}
              />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
};

export default Index;

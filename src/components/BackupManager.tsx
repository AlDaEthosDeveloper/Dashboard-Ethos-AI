import { useRef } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { saveAs } from 'file-saver';
import { useDashboard } from '@/contexts/DashboardContext';
import { getMachineIds, MachineId, MLCError, getBankFromErrorCode } from '@/data/mlcErrorData';
import { EVENT_LOG_TYPES, EventLogType } from '@/data/eventLogTypes';
import { GenericEvent, normalizeEventSeverity } from '@/data/genericEventData';
import { toast } from 'sonner';

interface BackupDataV1 {
  version: 1;
  exportDate: string;
  machines: Record<string, {
    errors: Array<Record<string, unknown>>;
    replacements: Array<Record<string, unknown>>;
    events: Record<string, Array<Record<string, unknown>>>;
  }>;
}

interface BackupDataV2 {
  version: 2;
  exportDate: string;
  machines: Record<string, {
    events: Array<{
      id: string;
      timestamp: string;
      machineSerial: string;
      logType: string;
      eventCode: string;
      component: string;
      description: string;
      severity: string;
      rawData?: Record<string, string>;
      mlcMotor?: number | null;
      errorPosition?: number | null;
      bank?: string | null;
      count?: number | null;
      min?: number | null;
      max?: number | null;
      avg?: number | null;
    }>;
    replacements?: Array<Record<string, unknown>>;
  }>;
}

type BackupData = BackupDataV1 | BackupDataV2;

/**
 * Executes `BackupManager`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const BackupManager = () => {
  const {
    machineData,
    getRawErrors,
    addErrors,
    addReplacements,
    eventData,
    addEvents,
    getEventsByType,
  } = useDashboard();

  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Executes `exportBackup`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const exportBackup = () => {
    const backup: BackupDataV2 = {
      version: 2,
      exportDate: new Date().toISOString(),
      machines: {},
    };

    let totalItems = 0;

    getMachineIds().forEach(id => {
      const rawErrors = getRawErrors(id);
      const replacements = machineData[id].replacements;
      const eventsByType = getEventsByType(id);

      const events: BackupDataV2['machines'][string]['events'] = [];

      rawErrors.forEach((error, index) => {
        events.push({
          id: `${id}-mlc-${error.timestamp.getTime()}-${error.errorCode}-${error.mlcMotor}-${error.bank}-${index}`,
          timestamp: error.timestamp.toISOString(),
          machineSerial: id,
          logType: 'MLC',
          eventCode: error.errorCode,
          component: error.component,
          description: error.errorText,
          severity: error.severity,
          rawData: {
            location: error.location,
            region: error.region,
            country: error.country,
            source: 'BackupManager.MLCError',
          },
          mlcMotor: error.mlcMotor,
          errorPosition: error.errorPosition,
          bank: error.bank,
        });
      });

      EVENT_LOG_TYPES.forEach(type => {
        const typedEvents = eventsByType[type] || [];
        typedEvents.forEach((event, index) => {
          events.push({
            id: event.id || `${id}-${type}-${event.timestamp.getTime()}-${event.eventCode}-${index}`,
            timestamp: event.timestamp.toISOString(),
            machineSerial: id,
            logType: event.logType,
            eventCode: event.eventCode,
            component: event.component,
            description: event.description,
            severity: event.severity,
            rawData: event.rawData,
            mlcMotor: null,
            errorPosition: null,
            bank: null,
            count: event.count ?? null,
            min: event.min ?? null,
            max: event.max ?? null,
            avg: event.avg ?? null,
          });
        });
      });

      const normalizedReplacements = replacements.map(r => ({
        ...r,
        replacementDate: r.replacementDate.toISOString(),
      }));

      totalItems += events.length + normalizedReplacements.length;

      if (events.length > 0 || normalizedReplacements.length > 0) {
        backup.machines[id] = {
          events,
          replacements: normalizedReplacements,
        };
      }
    });

    if (totalItems === 0) {
      toast.info('No data to export');
      return;
    }

    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    saveAs(blob, `ethos_backup_${format(new Date(), 'yyyyMMdd_HHmmss')}.json`);
    toast.success(`Exported ${totalItems} items across ${Object.keys(backup.machines).length} machine(s)`);
  };

  /**
   * Executes `importBackup`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const importBackup = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = JSON.parse(e.target?.result as string);

        if (!raw.version || !raw.machines) {
          toast.error('Invalid backup file format');
          return;
        }

        let totalItems = 0;

        if (raw.version === 2) {
          // V2 unified format
          const backup = raw as BackupDataV2;
          Object.entries(backup.machines).forEach(([machineId, data]) => {
            if (!getMachineIds().includes(machineId as MachineId)) return;
            const id = machineId as MachineId;

            // Separate MLC errors from other events
            const mlcEvents: MLCError[] = [];
            const otherEvents: GenericEvent[] = [];

            (data.events || []).forEach((evt) => {
              const ts = new Date(evt.timestamp);

              if (evt.logType === 'MLC' && evt.mlcMotor != null && evt.bank) {
                // Convert to MLCError
                mlcEvents.push({
                  timestamp: ts,
                  machineSerial: evt.machineSerial,
                  errorCode: evt.eventCode,
                  location: '',
                  region: '',
                  country: '',
                  component: evt.component,
                  errorText: evt.description,
                  severity: evt.severity,
                  mlcMotor: evt.mlcMotor,
                  errorPosition: evt.errorPosition ?? 0,
                  bank: evt.bank as 'A' | 'B',
                });
              } else {
                // Derive EventLogType from logType prefix
                let groupedLogType: EventLogType = 'Other';
                const rawLogType = evt.logType?.trim() || '';
                const upper = rawLogType.split('.')[0].toUpperCase();
                // Match both EventLogType names and raw component prefixes
                if (upper === 'COL') groupedLogType = 'COL';
                else if (upper === 'MLC') groupedLogType = 'MLC';
                else if (upper === 'BEAM' || upper === 'BGM') groupedLogType = 'Beam';
                else if (upper === 'MOTION' || upper === 'STN') groupedLogType = 'Motion';
                else if (upper === 'IMAGE' || upper === 'XI') groupedLogType = 'Image';
                else if (EVENT_LOG_TYPES.includes(rawLogType as EventLogType)) groupedLogType = rawLogType as EventLogType;

                otherEvents.push({
                  id: evt.id,
                  timestamp: ts,
                  machineSerial: id,
                  logType: rawLogType || groupedLogType,
                  eventCode: evt.eventCode,
                  component: evt.component,
                  description: evt.description,
                  severity: normalizeEventSeverity(evt.severity, evt.description),
                  rawData: {
                    ...(evt.rawData || {}),
                    groupedLogType,
                  },
                  count: evt.count ?? undefined,
                  min: evt.min ?? undefined,
                  max: evt.max ?? undefined,
                  avg: evt.avg ?? undefined,
                });
              }
            });

            if (mlcEvents.length > 0) {
              addErrors(id, mlcEvents);
              totalItems += mlcEvents.length;
            }

            // Group other events by logType and add
            const byType = new Map<EventLogType, GenericEvent[]>();
            otherEvents.forEach((ev) => {
              const groupedLogType = (ev.rawData?.groupedLogType as EventLogType | undefined) || 'Other';
              const arr = byType.get(groupedLogType) || [];
              arr.push(ev);
              byType.set(groupedLogType, arr);
            });
            byType.forEach((events, logType) => {
              addEvents(id, logType, events);
              totalItems += events.length;
            });

            // Import replacements if present
            if (data.replacements && data.replacements.length > 0) {
              const replacements = data.replacements.map((r: any) => ({
                ...r,
                replacementDate: new Date(r.replacementDate),
              }));
              addReplacements(id, replacements);
              totalItems += replacements.length;
            }
          });
        } else {
          // V1 format
          const backup = raw as BackupDataV1;
          Object.entries(backup.machines).forEach(([machineId, data]) => {
            if (!getMachineIds().includes(machineId as MachineId)) return;
            const id = machineId as MachineId;

            if (data.errors?.length > 0) {
              const errors = data.errors.map((e: any) => ({
                ...e,
                timestamp: new Date(e.timestamp),
              }));
              addErrors(id, errors);
              totalItems += errors.length;
            }

            if (data.replacements?.length > 0) {
              const replacements = data.replacements.map((r: any) => ({
                ...r,
                replacementDate: new Date(r.replacementDate),
              }));
              addReplacements(id, replacements);
              totalItems += replacements.length;
            }

            if (data.events) {
              Object.entries(data.events).forEach(([logType, events]) => {
                if (!EVENT_LOG_TYPES.includes(logType as EventLogType)) return;
                if (!Array.isArray(events) || events.length === 0) return;

                const parsed: GenericEvent[] = events.map((e: any) => ({
                  ...e,
                  timestamp: new Date(e.timestamp),
                }));
                addEvents(id, logType as EventLogType, parsed);
                totalItems += parsed.length;
              });
            }
          });
        }

        toast.success(`Imported ${totalItems} items from backup (${format(new Date(raw.exportDate), 'PPp')})`);
      } catch (err) {
        toast.error('Failed to parse backup file');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" className="gap-2" onClick={exportBackup}>
        <Download className="w-4 h-4" />
        Export Backup
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="w-4 h-4" />
        Import Backup
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            importBackup(file);
            e.target.value = '';
          }
        }}
      />
    </div>
  );
};

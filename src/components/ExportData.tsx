import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { MLCError, MotorReplacement, MachineId } from '@/data/mlcErrorData';
import { GenericEvent } from '@/data/genericEventData';
import { EventsByType } from '@/hooks/useEventLogData';
import { toast } from 'sonner';

interface ExportDataProps {
  machineId: MachineId;
  errors: MLCError[];
  replacements: MotorReplacement[];
  rawErrors?: MLCError[];
  eventsByType?: EventsByType;
}

/**
 * Executes `ExportData`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const ExportData = ({ 
  machineId, 
  errors, 
  replacements, 
  rawErrors,
  eventsByType 
}: ExportDataProps) => {
  /**
   * Executes `exportErrorsToCSV`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const exportErrorsToCSV = () => {
    if (errors.length === 0) {
      toast.info('No errors to export');
      return;
    }

    const headers = [
      'Timestamp',
      'Machine',
      'Error Code',
      'Motor',
      'Bank',
      'Error Position',
      'Error Type',
      'Hard Error',
      'Component',
      'Error Text',
      'Severity',
    ];

    const rows = errors.map(e => [
      format(e.timestamp, 'yyyy-MM-dd HH:mm:ss'),
      e.machineSerial,
      e.errorCode,
      e.mlcMotor,
      e.bank,
      e.errorPosition,
      e.isHardError ? 'Hard' : e.isMotorReplacement ? 'Init' : 'Normal',
      e.isHardError ? 'Yes' : 'No',
      e.component,
      e.errorText,
      e.severity,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => 
        typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell
      ).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `${machineId}_errors_${format(new Date(), 'yyyyMMdd')}.csv`);
    toast.success(`Exported ${errors.length} errors to CSV`);
  };

  /**
   * Executes `exportReplacementsToCSV`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const exportReplacementsToCSV = () => {
    if (replacements.length === 0) {
      toast.info('No replacements to export');
      return;
    }

    const headers = [
      'Motor',
      'Bank',
      'Replacement Date',
      'Replaced By',
      'Notes',
    ];

    const rows = replacements.map(r => [
      r.mlcMotor,
      r.bank,
      format(r.replacementDate, 'yyyy-MM-dd'),
      r.replacedBy,
      r.notes || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => 
        typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell
      ).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `${machineId}_replacements_${format(new Date(), 'yyyyMMdd')}.csv`);
    toast.success(`Exported ${replacements.length} replacements to CSV`);
  };

  /**
   * Executes `exportAllToExcel`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const exportAllToExcel = () => {
    if (errors.length === 0 && replacements.length === 0) {
      toast.info('No data to export');
      return;
    }

    const workbook = XLSX.utils.book_new();

    // Processed Errors sheet
    if (errors.length > 0) {
      const errorData = errors.map(e => ({
        'Timestamp': format(e.timestamp, 'yyyy-MM-dd HH:mm:ss'),
        'Machine': e.machineSerial,
        'Error Code': e.errorCode,
        'Motor': e.mlcMotor,
        'Bank': e.bank,
        'Error Position': e.errorPosition,
        'Error Type': e.isHardError ? 'Hard' : e.isMotorReplacement ? 'Init' : 'Normal',
        'Hard Error': e.isHardError ? 'Yes' : 'No',
        'Grouped Count': e.groupedCount || 1,
        'Component': e.component,
        'Error Text': e.errorText,
        'Severity': e.severity,
      }));
      const errorsSheet = XLSX.utils.json_to_sheet(errorData);
      XLSX.utils.book_append_sheet(workbook, errorsSheet, 'Processed Errors');
    }

    // Raw Errors sheet (if available)
    if (rawErrors && rawErrors.length > 0) {
      const rawErrorData = rawErrors.map(e => ({
        'Timestamp': format(e.timestamp, 'yyyy-MM-dd HH:mm:ss'),
        'Machine': e.machineSerial,
        'Error Code': e.errorCode,
        'Motor': e.mlcMotor,
        'Bank': e.bank,
        'Error Position': e.errorPosition,
        'Component': e.component,
        'Error Text': e.errorText,
        'Severity': e.severity,
      }));
      const rawErrorsSheet = XLSX.utils.json_to_sheet(rawErrorData);
      XLSX.utils.book_append_sheet(workbook, rawErrorsSheet, 'Raw Errors');
    }

    // Replacements sheet
    if (replacements.length > 0) {
      const replacementData = replacements.map(r => ({
        'Motor': r.mlcMotor,
        'Bank': r.bank,
        'Replacement Date': format(r.replacementDate, 'yyyy-MM-dd'),
        'Replaced By': r.replacedBy,
        'Notes': r.notes || '',
      }));
      const replacementsSheet = XLSX.utils.json_to_sheet(replacementData);
      XLSX.utils.book_append_sheet(workbook, replacementsSheet, 'Replacements');
    }

    // Other Events sheet (if available)
    if (eventsByType) {
      const allEvents: GenericEvent[] = [];
      Object.values(eventsByType).forEach(events => {
        allEvents.push(...events);
      });
      
      if (allEvents.length > 0) {
        const eventData = allEvents
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
          .map(e => ({
            'Timestamp': format(e.timestamp, 'yyyy-MM-dd HH:mm:ss'),
            'Machine': e.machineSerial,
            'Log Type': e.logType,
            'Event Code': e.eventCode,
            'Component': e.component,
            'Description': e.description,
            'Severity': e.severity,
            'Data1': e.data1 ?? '',
            'Data2': e.data2 ?? '',
          }));
        const eventsSheet = XLSX.utils.json_to_sheet(eventData);
        XLSX.utils.book_append_sheet(workbook, eventsSheet, 'Other Events');
      }
    }

    // Summary sheet
    const motorCounts: Record<string, { count: number; motor: number; bank: 'A' | 'B'; hardCount: number }> = {};
    errors.forEach(e => {
      const key = `${e.mlcMotor}-${e.bank}`;
      if (!motorCounts[key]) {
        motorCounts[key] = { count: 0, motor: e.mlcMotor, bank: e.bank, hardCount: 0 };
      }
      motorCounts[key].count++;
      if (e.isHardError) motorCounts[key].hardCount++;
    });

    const summaryData = Object.values(motorCounts)
      .sort((a, b) => b.count - a.count)
      .map(m => ({
        'Motor': m.motor,
        'Bank': m.bank,
        'Total Errors': m.count,
        'Hard Errors': m.hardCount,
        'Replaced': replacements.some(r => r.mlcMotor === m.motor && r.bank === m.bank) ? 'Yes' : 'No',
      }));

    if (summaryData.length > 0) {
      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    }

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${machineId}_report_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    toast.success('Exported report to Excel');
  };

  /**
   * Executes `exportRawToJSON`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const exportRawToJSON = () => {
    const exportData = {
      machineId,
      exportDate: new Date().toISOString(),
      rawErrors: (rawErrors || errors).map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
      processedErrors: errors.map(e => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
      replacements: replacements.map(r => ({
        ...r,
        replacementDate: r.replacementDate.toISOString(),
      })),
      events: eventsByType ? Object.fromEntries(
        Object.entries(eventsByType).map(([type, events]) => [
          type,
          events.map(e => ({
            ...e,
            timestamp: e.timestamp.toISOString(),
          })),
        ])
      ) : {},
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    saveAs(blob, `${machineId}_full_export_${format(new Date(), 'yyyyMMdd')}.json`);
    toast.success('Exported all data to JSON (raw + processed)');
  };

  /**
   * Executes `exportRawErrorsToCSV`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const exportRawErrorsToCSV = () => {
    const errorsToExport = rawErrors || errors;
    if (errorsToExport.length === 0) {
      toast.info('No raw errors to export');
      return;
    }

    const headers = [
      'Timestamp',
      'Machine',
      'Error Code',
      'Motor',
      'Bank',
      'Error Position',
      'Component',
      'Error Text',
      'Severity',
    ];

    const rows = errorsToExport.map(e => [
      format(e.timestamp, 'yyyy-MM-dd HH:mm:ss'),
      e.machineSerial,
      e.errorCode,
      e.mlcMotor,
      e.bank,
      e.errorPosition,
      e.component,
      e.errorText,
      e.severity,
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => 
        typeof cell === 'string' && cell.includes(',') ? `"${cell}"` : cell
      ).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `${machineId}_raw_errors_${format(new Date(), 'yyyyMMdd')}.csv`);
    toast.success(`Exported ${errorsToExport.length} raw errors to CSV`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="w-4 h-4" />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={exportAllToExcel}>
          Export All to Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportRawToJSON}>
          Export All to JSON (Backup)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>MLC Errors</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={exportErrorsToCSV}>
              Processed Errors (CSV)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={exportRawErrorsToCSV}>
              Raw Errors (CSV)
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={exportReplacementsToCSV}>
          Export Replacements to CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

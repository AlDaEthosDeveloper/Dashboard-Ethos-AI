import * as XLSX from 'xlsx';
import { MotorReplacement, MachineId } from '@/data/mlcErrorData';

const MACHINE_BLOCK_WIDTH = 4;
const MACHINE_BLOCK_STEP = 5;
const MACHINE_ID_PATTERN = /HAL\d{4}/i;
type SheetRows = any[][];

type MachineBlock = {
  machineId: string;
  start: number;
  label?: string;
};

const parseMotorAndBank = (value: string): { motor: number; bank: 'A' | 'B' } | null => {
  if (!value || typeof value !== 'string') return null;

  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^([AB])(\d+)$/);

  if (!match) return null;

  const bank = match[1] as 'A' | 'B';
  const motor = parseInt(match[2], 10);
  if (motor <= 0 || motor > 57) return null;

  return { motor, bank };
};

const parseDate = (value: unknown): Date | null => {
  if (!value) return null;

  if (typeof value === 'number') {
    const excelEpoch = new Date(1899, 11, 30);
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
};

const getSheetRows = (sheet: XLSX.WorkSheet): SheetRows =>
  XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

const detectMachineBlocks = (rows: SheetRows): MachineBlock[] => {
  const maxColumnCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), 0);
  const machineBlocks: MachineBlock[] = [];

  for (let start = 0; start < maxColumnCount; start += MACHINE_BLOCK_STEP) {
    const candidateCells: string[] = [];
    for (let rowIndex = 0; rowIndex < Math.min(3, rows.length); rowIndex += 1) {
      const row = rows[rowIndex] || [];
      for (let columnIndex = start; columnIndex < start + MACHINE_BLOCK_WIDTH; columnIndex += 1) {
        const value = String(row[columnIndex] ?? '').trim();
        if (value) candidateCells.push(value);
      }
    }

    const concatenated = candidateCells.join(' ');
    const machineIdMatch = concatenated.match(MACHINE_ID_PATTERN);
    if (!machineIdMatch) continue;

    const machineId = machineIdMatch[0].toUpperCase();
    if (machineBlocks.some((block) => block.machineId === machineId)) continue;

    const label = candidateCells.find((item) => !MACHINE_ID_PATTERN.test(item));
    machineBlocks.push({ machineId, start, label });
  }

  return machineBlocks;
};

const findFirstDataRowIndex = (rows: SheetRows, machineBlocks: MachineBlock[]) =>
  rows.findIndex((row, idx) => {
    if (idx < 1) return false;
    return machineBlocks.some((block) => parseMotorAndBank(String(row[block.start] ?? '')) !== null);
  });

export const parseReplacementWorkbook = (data: ArrayBuffer | Uint8Array) => {
  const normalized =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;

  const workbook = XLSX.read(normalized, { type: 'array' });

  // Sheet logging
  console.log('[Excel] SheetNames:', workbook.SheetNames);

  const sheetName =
    workbook.SheetNames.find(name =>
      name.toLowerCase().includes('motor')
    ) || workbook.SheetNames[0];

  console.log('[Excel] Selected sheet:', sheetName);

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    console.error('[Excel] No sheet found');
    return { error: 'No_sheet_found' };
  }

  // Row extraction
  const rows = getSheetRows(sheet);

  console.log('[Excel] Total raw rows:', rows.length);
  console.log('[Excel] First 5 rows:', rows.slice(0, 5));

  const machineBlocks = detectMachineBlocks(rows);

  // Row detection
  const firstDataRowIndex = findFirstDataRowIndex(rows, machineBlocks);

  const dataRows =
    firstDataRowIndex !== -1 ? rows.slice(firstDataRowIndex) : [];

  console.log('[Excel] First data row index:', firstDataRowIndex);
  console.log('[Excel] Data rows count:', dataRows.length);

  const replacementsByMachine: Record<MachineId, MotorReplacement[]> = Object.fromEntries(
    machineBlocks.map((block) => [block.machineId, [] as MotorReplacement[]]),
  );

  let totalCount = 0;
  let rejected = 0;

  dataRows.forEach((row, rowIndex) => {
    machineBlocks.forEach(({ machineId, start }) => {
      const motorValue = row[start];
      const dateValue = row[start + 1];
      const technicianValue = row[start + 2];
      const notesValue = row[start + 3];

      if (!motorValue || (typeof dateValue === 'string' && dateValue.toUpperCase() === 'X')) return;

      const motorInfo = parseMotorAndBank(String(motorValue));
      const date = parseDate(dateValue);

      if (!motorInfo || !date) {
          rejected++;
          if (rejected < 10) {
            console.log('[Excel][Reject]', {
              rowIndex,
              machineId,
              motorValue,
              dateValue
            });
          }
          return;
        }

      replacementsByMachine[machineId] = replacementsByMachine[machineId] || [];
      replacementsByMachine[machineId].push({
        id: `${machineId}-${motorInfo.bank}${motorInfo.motor}-${date.getTime()}-${rowIndex}`,
        machineSerial: machineId,
        mlcMotor: motorInfo.motor,
        bank: motorInfo.bank,
        replacementDate: date,
        replacedBy: String(technicianValue || '').trim(),
        notes: String(notesValue || '').trim() || undefined,
      });

      totalCount += 1;
    });
  });

  if (totalCount === 0) {
    console.warn('[Excel] No valid rows after parsing');
    console.warn('[Excel] Total valid:', totalCount);
    console.warn('[Excel] Total rejected:', rejected);
  }

  return { replacementsByMachine, totalCount };
};

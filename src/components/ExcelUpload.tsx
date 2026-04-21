import { useRef } from 'react';
import { Upload, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';
import { MLCError, MachineId, getBankFromErrorCode } from '@/data/mlcErrorData';
import { toast } from 'sonner';

interface ExcelUploadProps {
  machineId: MachineId;
  onDataLoaded: (data: MLCError[]) => void;
}

/**
 * Executes `ExcelUpload`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const ExcelUpload = ({ machineId, onDataLoaded }: ExcelUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Parses input data in `parseExcelFile`.
   *
   * @param args Function input.
   * @returns Parsed result.
   */
  const parseExcelFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        // Skip header row
        const rows = jsonData.slice(1).filter(row => row.length > 0);
        
        const errors: MLCError[] = rows.map(row => {
          // Parse timestamp from Excel serial or string
          let timestamp: Date;
          if (typeof row[0] === 'number') {
            // Excel serial date: days since 1899-12-30
            const excelEpoch = new Date(1899, 11, 30);
            timestamp = new Date(excelEpoch.getTime() + row[0] * 86400000);
          } else {
            timestamp = new Date(row[0]);
          }

          // Get error code and determine bank from error code parity
          const errorCode = String(row[2] || '');
          const bank = getBankFromErrorCode(errorCode);

          return {
            timestamp,
            machineSerial: machineId, // Use the current machine ID
            errorCode,
            location: String(row[3] || ''),
            region: String(row[4] || ''),
            country: String(row[5] || ''),
            component: String(row[6] || ''),
            errorText: String(row[7] || ''),
            severity: String(row[8] || ''),
            mlcMotor: parseInt(row[9]) || 0,
            errorPosition: parseFloat(row[10]) || 0,
            bank,
          };
        }).filter(error => error.mlcMotor > 0 && error.mlcMotor <= 57);

        if (errors.length > 0) {
          onDataLoaded(errors);
          toast.success(`Added ${errors.length} MLC errors to ${machineId}`);
        } else {
          toast.error('No valid MLC errors found in file');
        }
      } catch (error) {
        console.error('Error parsing Excel file:', error);
        toast.error('Failed to parse Excel file');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  /**
   * Executes `handleFileChange`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseExcelFile(file);
    }
    // Reset input so same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileChange}
        className="hidden"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        className="gap-2"
      >
        <Upload className="w-4 h-4" />
        <FileSpreadsheet className="w-4 h-4" />
        Upload Excel
      </Button>
    </div>
  );
};

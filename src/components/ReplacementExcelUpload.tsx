import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MotorReplacement, MachineId } from '@/data/mlcErrorData';
import { parseReplacementWorkbook } from '@/lib/replacementImport';
import { toast } from 'sonner';

interface ReplacementExcelUploadProps {
  onReplacementsLoaded: (machineId: MachineId, replacements: MotorReplacement[]) => void;
  onImportPathDetected?: (path: string) => void;
}

/**
 * Executes `ReplacementExcelUpload`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const ReplacementExcelUpload = ({ onReplacementsLoaded, onImportPathDetected }: ReplacementExcelUploadProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const detectImportPath = (file: File, inputValue?: string): string => {
    const filePath = String((file as File & { path?: string }).path || '').trim();
    if (filePath) return filePath;

    const rawInputPath = String(inputValue || '').trim();
    if (!rawInputPath) return '';
    if (rawInputPath.toLowerCase().includes('fakepath')) return '';
    return rawInputPath;
  };

  const parseExcelFile = async (file: File, inputValue?: string) => {
    setIsProcessing(true);
    
    try {
      const desktopPath = detectImportPath(file, inputValue);
      if (desktopPath) {
        onImportPathDetected?.(desktopPath);
      }

      const data = await file.arrayBuffer();
      const { replacementsByMachine, totalCount } = parseReplacementWorkbook(data);

      // Report results
      if (totalCount > 0) {
        Object.entries(replacementsByMachine).forEach(([machineId, replacements]) => {
          if (replacements.length > 0) {
            onReplacementsLoaded(machineId, replacements);
          }
        });

        const summary = Object.entries(replacementsByMachine)
          .filter(([, replacements]) => replacements.length > 0)
          .map(([machineId, replacements]) => `${machineId}: ${replacements.length}`)
          .join(', ');
        
        toast.success(`Imported ${totalCount} motor replacements (${summary})`);
      } else {
        toast.info('No valid motor replacements found in the Excel file');
      }
    } catch (error) {
      console.error('Error parsing Excel file:', error);
      toast.error('Failed to parse Excel file');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
      parseExcelFile(file, e.target.value);
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
        disabled={isProcessing}
      >
        {isProcessing ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Upload className="w-4 h-4" />
            <FileSpreadsheet className="w-4 h-4" />
          </>
        )}
        {isProcessing ? 'Importing...' : 'Import Replacements'}
      </Button>
    </div>
  );
};

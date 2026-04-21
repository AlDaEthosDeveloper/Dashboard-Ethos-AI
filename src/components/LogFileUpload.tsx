import { useRef, useState } from 'react';
import { Upload, FolderOpen, FileArchive, FileCode, Loader2, FolderArchive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import JSZip from 'jszip';
import { MLCError, MachineId } from '@/data/mlcErrorData';
import { parseXMLLogContent, isEventLogFile, extractMachineIdFromFilename } from '@/lib/xmlLogParser';
import { toast } from 'sonner';

interface LogFileUploadProps {
  machineId: MachineId;
  onDataLoaded: (machineId: MachineId, data: MLCError[]) => void;
}

/**
 * Executes `LogFileUpload`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const LogFileUpload = ({ machineId, onDataLoaded }: LogFileUploadProps) => {
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Group errors by their parsed machineSerial and dispatch per machine
  /**
   * Executes `dispatchByMachine`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const dispatchByMachine = (errors: MLCError[]) => {
    const byMachine = new Map<MachineId, MLCError[]>();
    errors.forEach(error => {
      const id = error.machineSerial as MachineId;
      if (!byMachine.has(id)) byMachine.set(id, []);
      byMachine.get(id)!.push(error);
    });
    byMachine.forEach((machineErrors, id) => {
      onDataLoaded(id, machineErrors);
    });
  };
  const zipInputRef = useRef<HTMLInputElement>(null);
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const zipFolderInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');

  // Handle folder upload (webkitdirectory)
  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    try {
      const allErrors: MLCError[] = [];
      let processedCount = 0;

      for (const file of Array.from(files)) {
        // Check if this is a COLEventLog.xml file in EventLog folder
        if (isEventLogFile(file.webkitRelativePath || file.name)) {
          const content = await file.text();
          const errors = parseXMLLogContent(content, machineId);
          allErrors.push(...errors);
          processedCount++;
        }
      }

      if (allErrors.length > 0) {
        dispatchByMachine(allErrors);
        toast.success(`Parsed ${allErrors.length} errors from ${processedCount} log files`);
      } else {
        toast.info('No COLEventLog.xml files found in the selected folder');
      }
    } catch (error) {
      console.error('Error processing folder:', error);
      toast.error('Failed to process folder');
    } finally {
      setIsProcessing(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // Process a single ZIP file and return errors - looks for EventLog folders
  // Path structure: */VMSOS/AppData/TDS/Output/EventLog/*/_COLEventLog.xml
  const processZipFile = async (file: File | Blob, filename: string): Promise<{ errors: MLCError[], fileCount: number }> => {
    const zip = await JSZip.loadAsync(file);
    const errors: MLCError[] = [];
    let fileCount = 0;

    // Try to extract machine ID from ZIP filename
    const detectedMachineId = extractMachineIdFromFilename(filename);
    const targetMachineId = detectedMachineId || machineId;

    // Find all COLEventLog.xml files in the correct deep path structure
    // Path: */VMSOS/AppData/TDS/Output/EventLog/*/_COLEventLog.xml
    // Note: JSZip may keep original path separators (backslashes on Windows)
    const promises: Promise<void>[] = [];
    
    // Debug: log all paths to find the correct pattern
    const allPaths: string[] = [];
    zip.forEach((relativePath) => {
      allPaths.push(relativePath);
    });
    console.log('All paths in ZIP:', allPaths.filter(p => p.toLowerCase().includes('eventlog')));
    
    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      
      // Normalize path separators (handle both forward and backslashes)
      const normalizedPath = relativePath.replace(/\\/g, '/').toLowerCase();
      
      // Check for EventLog path with COLEventLog.xml file
      // The path should contain EventLog folder and include _coleventlog.xml
      const isEventLog = 
        normalizedPath.includes('/eventlog/') && 
        normalizedPath.includes('_coleventlog.xml');
      
      if (isEventLog) {
        console.log('Found COLEventLog:', relativePath);
        promises.push(
          zipEntry.async('text').then(content => {
            // parseXMLLogContent now extracts machineId from XML content
            const parsedErrors = parseXMLLogContent(content, targetMachineId);
            errors.push(...parsedErrors);
            fileCount++;
          })
        );
      }
    });

    await Promise.all(promises);
    console.log(`Processed ${fileCount} EventLog files from ${filename}, found ${errors.length} errors`);
    return { errors, fileCount };
  };

  // Process a folder of files from a ZIP (simulating EventLog folder upload)
  const processEventLogFolder = async (files: FileList): Promise<{ errors: MLCError[], fileCount: number }> => {
    const errors: MLCError[] = [];
    let fileCount = 0;

    for (const file of Array.from(files)) {
      const relativePath = file.webkitRelativePath || file.name;
      if (isEventLogFile(relativePath)) {
        const content = await file.text();
        const parsedErrors = parseXMLLogContent(content, machineId);
        errors.push(...parsedErrors);
        fileCount++;
      }
    }

    return { errors, fileCount };
  };

  // Handle ZIP file upload
  const handleZipChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const { errors, fileCount } = await processZipFile(file, file.name);

      if (errors.length > 0) {
        dispatchByMachine(errors);
        toast.success(`Parsed ${errors.length} errors from ${fileCount} log files in ZIP`);
      } else {
        toast.info('No COLEventLog.xml files found in the ZIP archive');
      }
    } catch (error) {
      console.error('Error processing ZIP:', error);
      toast.error('Failed to process ZIP file');
    } finally {
      setIsProcessing(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  // Handle folder of ZIP archives
  const handleZipFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    try {
      const allErrors: MLCError[] = [];
      let totalLogFiles = 0;
      let processedZips = 0;

      // Filter for ZIP files only
      const zipFiles = Array.from(files).filter(file => 
        file.name.toLowerCase().endsWith('.zip')
      );

      if (zipFiles.length === 0) {
        toast.info('No ZIP files found in the selected folder');
        setIsProcessing(false);
        return;
      }

      setProcessingStatus(`Processing 0/${zipFiles.length} ZIP files...`);

      for (const file of zipFiles) {
        try {
          setProcessingStatus(`Processing ${processedZips + 1}/${zipFiles.length}: ${file.name}`);
          const { errors, fileCount } = await processZipFile(file, file.name);
          allErrors.push(...errors);
          totalLogFiles += fileCount;
          processedZips++;
        } catch (error) {
          console.error(`Error processing ZIP ${file.name}:`, error);
          // Continue with other files
        }
      }

      setProcessingStatus('');

      if (allErrors.length > 0) {
        dispatchByMachine(allErrors);
        toast.success(`Parsed ${allErrors.length} errors from ${totalLogFiles} log files across ${processedZips} ZIP archives`);
      } else {
        toast.info('No COLEventLog.xml files found in any ZIP archive');
      }
    } catch (error) {
      console.error('Error processing ZIP folder:', error);
      toast.error('Failed to process ZIP folder');
    } finally {
      setIsProcessing(false);
      setProcessingStatus('');
      if (zipFolderInputRef.current) zipFolderInputRef.current.value = '';
    }
  };

  // Handle single XML file upload
  const handleXMLChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const content = await file.text();
      const errors = parseXMLLogContent(content, machineId);

      if (errors.length > 0) {
        dispatchByMachine(errors);
        toast.success(`Parsed ${errors.length} errors from ${file.name}`);
      } else {
        toast.info('No MLC errors found in the XML file');
      }
    } catch (error) {
      console.error('Error processing XML:', error);
      toast.error('Failed to process XML file');
    } finally {
      setIsProcessing(false);
      if (xmlInputRef.current) xmlInputRef.current.value = '';
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Hidden inputs */}
      <input
        ref={folderInputRef}
        type="file"
        {...{ webkitdirectory: '', directory: '' } as any}
        multiple
        onChange={handleFolderChange}
        className="hidden"
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        onChange={handleZipChange}
        className="hidden"
      />
      <input
        ref={xmlInputRef}
        type="file"
        accept=".xml"
        onChange={handleXMLChange}
        className="hidden"
      />
      <input
        ref={zipFolderInputRef}
        type="file"
        {...{ webkitdirectory: '', directory: '' } as any}
        multiple
        onChange={handleZipFolderChange}
        className="hidden"
      />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2" disabled={isProcessing}>
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {processingStatus || 'Import Logs'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => zipFolderInputRef.current?.click()}>
            <FolderArchive className="w-4 h-4 mr-2" />
            Scan Folder of ZIP Archives
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
            <FolderOpen className="w-4 h-4 mr-2" />
            Upload EventLog Folder
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => zipInputRef.current?.click()}>
            <FileArchive className="w-4 h-4 mr-2" />
            Upload ZIP Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => xmlInputRef.current?.click()}>
            <FileCode className="w-4 h-4 mr-2" />
            Upload Single XML File
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

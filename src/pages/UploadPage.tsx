import { useDashboard } from '@/contexts/DashboardContext';
import { ExcelUpload } from '@/components/ExcelUpload';
import { LogFileUpload } from '@/components/LogFileUpload';
import { ReplacementExcelUpload } from '@/components/ReplacementExcelUpload';
import { FolderScannerUI } from '@/components/FolderScannerUI';
import { BackupManager } from '@/components/BackupManager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, FolderOpen, FileSpreadsheet, FileText, Trash2 } from 'lucide-react';
import { useAppConfig } from '@/contexts/AppConfigContext';

/**
 * Executes `UploadPage`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
const UploadPage = () => {
  const { 
    selectedMachine, 
    addErrors, 
    addReplacements,
    clearAllData,
  } = useDashboard();
  const { config, updateConfig } = useAppConfig();

  const handleImportPathDetected = (path: string) => {
    const cleanPath = path.trim();
    if (!cleanPath || cleanPath === config.replacementsImportPath) return;
    updateConfig({
      ...config,
      replacementsImportPath: cleanPath,
    });
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Upload Data</h2>
          <p className="text-muted-foreground">
            Import MLC errors, event logs, and motor replacement data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={clearAllData}>
            <Trash2 className="h-4 w-4 mr-1" />
            Clear All Data
          </Button>
          <BackupManager />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Folder Scanner */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary" />
              Folder Scanner
            </CardTitle>
            <CardDescription>
              Scan a folder for log files (XML, TXT, ZIP) and import all data automatically. 
              <span className="text-primary font-medium"> Continues in background when switching tabs.</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FolderScannerUI />
          </CardContent>
        </Card>
        
        {/* Excel Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Upload Excel
            </CardTitle>
            <CardDescription>
              Import MLC error data from Excel spreadsheets
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ExcelUpload 
              machineId={selectedMachine} 
              onDataLoaded={(errors) => addErrors(selectedMachine, errors)} 
            />
          </CardContent>
        </Card>
        
        {/* Log File Upload */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Import Logs
            </CardTitle>
            <CardDescription>
              Import individual log files (XML, TXT)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LogFileUpload 
              machineId={selectedMachine} 
              onDataLoaded={(machineId, errors) => addErrors(machineId, errors)} 
            />
          </CardContent>
        </Card>
        
        {/* Replacement Upload */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              Import Replacements
            </CardTitle>
            <CardDescription>
              Import motor replacement history from Excel files
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReplacementExcelUpload
              onReplacementsLoaded={addReplacements}
              onImportPathDetected={handleImportPathDetected}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default UploadPage;

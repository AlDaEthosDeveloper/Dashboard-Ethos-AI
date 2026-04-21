import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Wrench, AlertCircle} from 'lucide-react';
import { MLCError, MotorReplacement } from '@/data/mlcErrorData';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';

interface ErrorTableProps {
  errors: MLCError[];
  selectedMotors: Array<{ motor: number; bank: 'A' | 'B' }>;
  replacements: MotorReplacement[];
}

/**
 * Executes `ErrorTable`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const ErrorTable = ({ errors, selectedMotors, replacements }: ErrorTableProps) => {
  const [isOpen, setIsOpen] = useState(true); // For collapsing the window

  const filteredErrors = selectedMotors.length > 0
    ? errors.filter(error => selectedMotors.some(selection => selection.motor === error.mlcMotor && selection.bank === error.bank))
    : errors;

  const displayErrors = filteredErrors.slice(0, 50);

  /**
   * Retrieves data for `getErrorTypeBadge`.
   *
   * @param args Function input.
   * @returns Retrieved value.
   */
  const getErrorTypeBadge = (error: MLCError) => {
    if (error.isMotorReplacement) {
      return (
        <Badge variant="secondary" className="bg-purple-500/20 text-purple-400 gap-1">
          <Wrench className="w-3 h-3" />
          Init
        </Badge>
      );
    }
    if (error.isHardError) {
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="w-3 h-3" />
          Hard
          {error.groupedCount && error.groupedCount > 1 && (
            <span className="ml-1">({error.groupedCount})</span>
          )}
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        {error.errorText.includes('Drift') ? 'Drift' : 'Deviation'}
      </Badge>
    );
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="bg-card rounded-xl border border-border">
        <div className="p-6 border-b border-border">
          <div className="flex items-center justify-between">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1"
              >
                {isOpen ? (
                  <ChevronDown className="h-5 w-5 text-primary" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-primary" />
                )}
                <h3 className="text-lg font-semibold text-foreground">
                  Recent Errors
                  {selectedMotors.length > 0 && (
                    <span className="ml-2 text-primary">
                      ({selectedMotors.length} motor{selectedMotors.length > 1 ? 's' : ''} selected)
                    </span>
                  )}
                </h3>
              </Button>
            </CollapsibleTrigger>
            <span className="text-sm text-muted-foreground">
              Showing {displayErrors.length} of {filteredErrors.length} errors
            </span>
          </div>
        </div>

        <CollapsibleContent>
          <Table>
            <ScrollArea className="h-96">
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">Timestamp</TableHead>
                  <TableHead className="text-muted-foreground">Motor</TableHead>
                  <TableHead className="text-muted-foreground">Bank</TableHead>
                  <TableHead className="text-muted-foreground">Error Type</TableHead>
                  <TableHead className="text-muted-foreground">Position</TableHead>
                  <TableHead className="text-muted-foreground">Code</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {displayErrors.map((error, index) => (
                  <TableRow key={index} className="border-border">
                    <TableCell className="font-mono text-sm text-foreground">
                      {format(error.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {error.mlcMotor}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="secondary"
                        className={error.bank === 'A' ? 'bg-chart-1/20 text-chart-1' : 'bg-chart-2/20 text-chart-2'}
                      >
                        {error.bank}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-help">
                            {getErrorTypeBadge(error)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="bg-popover border-border max-w-sm">
                          <div className="space-y-1">
                            <p className="font-semibold">Full Error Description</p>
                            <p className="text-sm text-muted-foreground">{error.errorText}</p>
                            {error.isHardError && (
                              <p className="text-sm text-danger">
                                Hard error: {error.groupedCount || 1} errors within 30 seconds
                              </p>
                            )}
                            {error.isMotorReplacement && (
                              <p className="text-sm text-purple-400">
                                Probable cause: Motor replacement and initialization
                              </p>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {error.errorPosition.toFixed(2)} mm
                    </TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {error.errorCode}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ScrollArea>
          </Table>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

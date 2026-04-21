import { useState } from 'react';
import { format, parse, isValid } from 'date-fns';
import { Plus, Wrench, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MotorReplacement, MachineId, MLCError } from '@/data/mlcErrorData';


interface MotorReplacementFormProps {
  machineId: MachineId;
  replacements: MotorReplacement[];
  errors: MLCError[];
  onAddReplacement: (replacement: MotorReplacement) => void;
  onRemoveReplacement: (replacementId: string) => void;
}

// Count errors after a replacement date for a specific motor/bank
/**
 * Retrieves data for `getPostReplacementErrors`.
 *
 * @param args Function input.
 * @returns Retrieved value.
 */
const getPostReplacementErrors = (
  errors: MLCError[],
  replacement: MotorReplacement
): number => {
  const oneDayAfterReplacement = new Date(
    replacement.replacementDate.getTime() + 24 * 60 * 60 * 1000
  );

  return errors.filter(
    e =>
      e.mlcMotor === replacement.mlcMotor &&
      e.bank === replacement.bank &&
      e.timestamp > oneDayAfterReplacement
  ).length;
};


/**
 * Executes `MotorReplacementForm`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const MotorReplacementForm = ({
  machineId,
  replacements,
  errors,
  onAddReplacement,
  onRemoveReplacement,
}: MotorReplacementFormProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [motors, setMotors] = useState<string>(''); // Comma-separated motor numbers
  const [bank, setBank] = useState<'A' | 'B'>('A');
  const [date, setDate] = useState<Date>(new Date());
  const [dateInput, setDateInput] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [replacedBy, setReplacedBy] = useState('');
  const [notes, setNotes] = useState('');

  /**
   * Executes `handleDateInputChange`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleDateInputChange = (value: string) => {
    setDateInput(value);
    // Try to parse the date
    const parsed = parse(value, 'yyyy-MM-dd', new Date());
    if (isValid(parsed)) {
      setDate(parsed);
    }
  };

  /**
   * Executes `handleCalendarSelect`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleCalendarSelect = (d: Date | undefined) => {
    if (d) {
      setDate(d);
      setDateInput(format(d, 'yyyy-MM-dd'));
    }
  };

  /**
   * Parses input data in `parseMotorNumbers`.
   *
   * @param args Function input.
   * @returns Parsed result.
   */
  const parseMotorNumbers = (input: string): number[] => {
    const parts = input.split(/[,\s]+/).filter(Boolean);
    const motors: number[] = [];
    
    for (const part of parts) {
      // Handle ranges like "1-5"
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(s => parseInt(s.trim()));
        if (!isNaN(start) && !isNaN(end) && start <= end && start >= 1 && end <= 57) {
          for (let i = start; i <= end; i++) {
            if (!motors.includes(i)) motors.push(i);
          }
        }
      } else {
        const num = parseInt(part.trim());
        if (!isNaN(num) && num >= 1 && num <= 57 && !motors.includes(num)) {
          motors.push(num);
        }
      }
    }
    
    return motors.sort((a, b) => a - b);
  };

  const parsedMotors = parseMotorNumbers(motors);

  /**
   * Executes `handleSubmit`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (parsedMotors.length === 0 || !replacedBy) return;

    // Create a replacement for each motor
    parsedMotors.forEach(motorNum => {
      const replacement: MotorReplacement = {
        id: crypto.randomUUID(),
        machineSerial: machineId,
        mlcMotor: motorNum,
        bank,
        replacementDate: date,
        replacedBy,
        notes: notes || undefined,
      };
      onAddReplacement(replacement);
    });
    
    // Reset form
    setMotors('');
    setBank('A');
    setDate(new Date());
    setDateInput(format(new Date(), 'yyyy-MM-dd'));
    setReplacedBy('');
    setNotes('');
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Wrench className="w-4 h-4" />
          Motor Replacements
          {replacements.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {replacements.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-5 h-5" />
            Motor Replacements - {machineId}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Add new replacement form */}
          <form onSubmit={handleSubmit} className="space-y-4 p-4 border border-border rounded-lg bg-muted/30">
            <h4 className="font-medium text-sm text-foreground">Add New Replacement(s)</h4>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="motors">Motor Number(s)</Label>
                <Input
                  id="motors"
                  value={motors}
                  onChange={(e) => setMotors(e.target.value)}
                  placeholder="e.g., 18 or 1,5,18 or 10-15"
                />
                <p className="text-xs text-muted-foreground">
                  Enter single (18), multiple (1,5,18), or range (10-15)
                </p>
                {parsedMotors.length > 0 && (
                  <p className="text-xs text-primary">
                    Will add: {parsedMotors.join(', ')} ({parsedMotors.length} motor{parsedMotors.length > 1 ? 's' : ''})
                  </p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="bank">Bank</Label>
                <Select value={bank} onValueChange={(v) => setBank(v as 'A' | 'B')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">Bank A</SelectItem>
                    <SelectItem value="B">Bank B</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Replacement Date</Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={dateInput}
                    onChange={(e) => handleDateInputChange(e.target.value)}
                    className="flex-1"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="icon" type="button">
                        📅
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 pointer-events-auto" align="start">
                      <Calendar
                        mode="single"
                        selected={date}
                        onSelect={handleCalendarSelect}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="replacedBy">Replaced By</Label>
                <Input
                  id="replacedBy"
                  value={replacedBy}
                  onChange={(e) => setReplacedBy(e.target.value)}
                  placeholder="Technician name"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes..."
              />
            </div>

            <Button type="submit" className="gap-2" disabled={parsedMotors.length === 0 || !replacedBy}>
              <Plus className="w-4 h-4" />
              Add {parsedMotors.length > 1 ? `${parsedMotors.length} Replacements` : 'Replacement'}
            </Button>
          </form>

          {/* List of replacements */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm text-foreground">
              Replacement History ({replacements.length})
            </h4>
            
            {replacements.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No motor replacements recorded yet.
              </p>
            ) : (
              <ScrollArea className="h-64">
                <div className="space-y-2">
                  {replacements
                    .sort((a, b) => b.replacementDate.getTime() - a.replacementDate.getTime())
                    .map((r) => {
                      const postErrors = getPostReplacementErrors(errors, r);
                      return (
                        <div
                          key={r.id}
                          className="flex items-center justify-between p-3 border border-border rounded-lg bg-card"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="font-mono">
                                M{r.mlcMotor}
                              </Badge>
                              <Badge 
                                variant="secondary"
                                className={r.bank === 'A' ? 'bg-chart-1/20 text-chart-1' : 'bg-chart-2/20 text-chart-2'}
                              >
                                {r.bank}
                              </Badge>
                            </div>
                            <div className="text-sm">
                              <span className="text-foreground">{format(r.replacementDate, 'MMM dd, yyyy')}</span>
                              <span className="text-muted-foreground"> by </span>
                              <span className="text-foreground">{r.replacedBy}</span>
                              {r.notes && (
                                <span className="text-muted-foreground"> • {r.notes}</span>
                              )}
                            </div>
                            {/* Post-replacement error indicator */}
                            <div className="flex items-center gap-1 ml-2">
                              {postErrors > 0 ? (
                                <Badge variant="destructive" className="gap-1 text-xs">
                                  <AlertCircle className="w-3 h-3" />
                                  {postErrors} error{postErrors > 1 ? 's' : ''} after
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1 text-xs text-green-500 border-green-500/30">
                                  <CheckCircle2 className="w-3 h-3" />
                                  No errors after
                                </Badge>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemoveReplacement(r.id)}
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      );
                    })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

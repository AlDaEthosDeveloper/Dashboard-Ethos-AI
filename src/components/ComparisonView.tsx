import { useMemo, useState } from 'react';
import { format, subDays, addDays, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { GitCompare, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { MLCError, MotorReplacement } from '@/data/mlcErrorData';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceLine as RechartsReferenceLine, // Rename import to avoid conflict
  ReferenceArea, // Ensure ReferenceArea is imported if needed
} from 'recharts';

interface ComparisonViewProps {
  errors: MLCError[];
  replacements: MotorReplacement[];
}

/**
 * Executes `ComparisonView`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const ComparisonView = ({ errors, replacements }: ComparisonViewProps) => {
  const [selectedReplacement, setSelectedReplacement] = useState<string>('');
  const [comparisonDays, setComparisonDays] = useState(30);
  const [expandedTable, setExpandedTable] = useState(true);

  // Get unique replacements with sufficient data
  const validReplacements = useMemo(() => {
    return replacements.filter(r => {
      const beforeDate = subDays(r.replacementDate, comparisonDays);
      const afterDate = addDays(r.replacementDate, comparisonDays);
      
      // Check if there are errors in both periods
      const beforeErrors = errors.some(e => 
        e.mlcMotor === r.mlcMotor && 
        e.bank === r.bank &&
        isWithinInterval(e.timestamp, { start: beforeDate, end: r.replacementDate })
      );
      
      return true; // Show all replacements even without before errors
    });
  }, [replacements, errors, comparisonDays]);

  const selectedReplacementData = useMemo(() => {
    if (!selectedReplacement) return null;
    return replacements.find(r => r.id === selectedReplacement);
  }, [selectedReplacement, replacements]);

  // Calculate comparison data
  const comparisonData = useMemo(() => {
    if (!selectedReplacementData) return null;

    const replacementDate = selectedReplacementData.replacementDate;
    const beforeStart = subDays(replacementDate, comparisonDays);
    const afterEnd = addDays(replacementDate, comparisonDays);
  
    // Get errors for this motor
    const motorErrors = errors.filter(e => 
      e.mlcMotor === selectedReplacementData.mlcMotor &&
      e.bank === selectedReplacementData.bank
    );

    const effectiveReplacementDate = addDays(replacementDate, 1);

    const beforeErrors = motorErrors.filter(e =>
      isWithinInterval(e.timestamp, {
        start: startOfDay(beforeStart),
        end: endOfDay(replacementDate),
      })
    );

    const afterErrors = motorErrors.filter(e =>
      isWithinInterval(e.timestamp, {
        start: startOfDay(effectiveReplacementDate),
        end: endOfDay(afterEnd),
      })
    );


    // Daily breakdown for timeline
    const dailyData: Array<{ date: string; fullDate: string; before: number; after: number; isReplacementDay: boolean }> = [];
    
    for (let i = -comparisonDays; i <= comparisonDays; i++) {
      const day = addDays(replacementDate, i);
      const dayStr = format(day, 'yyyy-MM-dd');
      
      const dayErrors = motorErrors.filter(e => 
        format(e.timestamp, 'yyyy-MM-dd') === dayStr
      );

      dailyData.push({
        date: format(day, 'MMM dd'),
        fullDate: format(day, 'MMM dd, yyyy'),
        before: i < 0 ? dayErrors.length : 0,
        after: i >= 1 ? dayErrors.length : 0,
        isReplacementDay: i === 0,
      });
    }

    const beforeCount = beforeErrors.length;
    const afterCount = afterErrors.length;
    const improvement = beforeCount > 0 
      ? Math.round(((beforeCount - afterCount) / beforeCount) * 100)
      : afterCount === 0 ? 100 : -100;

    return {
      beforeErrors,
      afterErrors,
      beforeCount,
      afterCount,
      improvement,
      dailyData,
      replacementDate,
    };
  }, [selectedReplacementData, errors, comparisonDays]);

  // Summary table for all replacements
  const summaryData = useMemo(() => {
    return validReplacements.map(r => {
      const beforeStart = subDays(r.replacementDate, comparisonDays);
      const afterEnd = addDays(r.replacementDate, comparisonDays);

      const motorErrors = errors.filter(e => 
        e.mlcMotor === r.mlcMotor && e.bank === r.bank
      );

      const effectiveReplacementDate = addDays(r.replacementDate, 1);

      const beforeCount = motorErrors.filter(e =>
        isWithinInterval(e.timestamp, {
          start: startOfDay(beforeStart),
          end: endOfDay(r.replacementDate),
        })
      ).length;

      const afterCount = motorErrors.filter(e =>
        isWithinInterval(e.timestamp, {
          start: startOfDay(effectiveReplacementDate),
          end: endOfDay(afterEnd),
        })
      ).length;

      const improvement = beforeCount > 0 
        ? Math.round(((beforeCount - afterCount) / beforeCount) * 100)
        : afterCount === 0 ? 100 : -100;

      return {
        ...r,
        beforeCount,
        afterCount,
        improvement,
      };
    }).sort((a, b) => b.improvement - a.improvement);
  }, [validReplacements, errors, comparisonDays]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <GitCompare className="w-4 h-4" />
          Compare
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5" />
            Motor Replacement Comparison
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Controls */}
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-2 flex-1 min-w-[200px]">
              <Label>Select Replacement</Label>
              <Select value={selectedReplacement} onValueChange={setSelectedReplacement}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a motor replacement..." />
                </SelectTrigger>
                <SelectContent>
                  {validReplacements.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      Motor {r.mlcMotor} Bank {r.bank} - {format(r.replacementDate, 'yyyy-MM-dd')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 w-32">
              <Label>Days Before/After</Label>
              <Input
                type="number"
                min={7}
                max={90}
                value={comparisonDays}
                onChange={(e) => setComparisonDays(parseInt(e.target.value) || 30)}
              />
            </div>
          </div>

          {comparisonData && selectedReplacementData && (
            <>
              {/* Stats Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-muted/50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold">{comparisonData.beforeCount}</div>
                  <div className="text-sm text-muted-foreground">Errors Before</div>
                  <div className="text-xs text-muted-foreground">
                    {comparisonDays} days prior
                  </div>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold">{comparisonData.afterCount}</div>
                  <div className="text-sm text-muted-foreground">Errors After</div>
                  <div className="text-xs text-muted-foreground">
                    {comparisonDays} days after
                  </div>
                </div>
                <div className={`rounded-lg p-4 text-center ${
                  comparisonData.improvement > 0 
                    ? 'bg-green-500/10 text-green-600' 
                    : comparisonData.improvement < 0 
                      ? 'bg-red-500/10 text-red-600' 
                      : 'bg-muted/50'
                }`}>
                  <div className="text-2xl font-bold flex items-center justify-center gap-1">
                    {comparisonData.improvement > 0 ? (
                      <TrendingDown className="w-6 h-6" />
                    ) : comparisonData.improvement < 0 ? (
                      <TrendingUp className="w-6 h-6" />
                    ) : (
                      <Minus className="w-6 h-6" />
                    )}
                    {Math.abs(comparisonData.improvement)}%
                  </div>
                  <div className="text-sm">
                    {comparisonData.improvement > 0 
                      ? 'Improvement' 
                      : comparisonData.improvement < 0 
                        ? 'Degradation' 
                        : 'No Change'}
                  </div>
                </div>
              </div>

              {/* Timeline Chart */}
              <div className="bg-card border border-border rounded-lg p-4">
                <h4 className="font-medium mb-4">Error Timeline (Before vs After)</h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={comparisonData.dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis 
                        dataKey="date" 
                        tick={{ fontSize: 10 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis allowDecimals={false} />
                      <Tooltip 
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullDate || ''}
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                      <Legend />
                      <RechartsReferenceLine 
                        x={comparisonData.dailyData.find(d => d.isReplacementDay)?.date || ''} 
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        label={{ value: 'Replacement', position: 'top', fontSize: 10 }}
                      />
                      <Bar dataKey="before" name="Before Replacement" fill="hsl(var(--destructive))" />
                      <Bar dataKey="after" name="After Replacement" fill="hsl(var(--primary))" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}

          {/* Summary Table */}
          <div className="bg-card border border-border rounded-lg">
            <button
              onClick={() => setExpandedTable(!expandedTable)}
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
            >
              <h4 className="font-medium">All Replacements Summary</h4>
              {expandedTable ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            
            {expandedTable && (
              <div className="border-t border-border overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left p-3 text-sm font-medium">Motor</th>
                      <th className="text-left p-3 text-sm font-medium">Bank</th>
                      <th className="text-left p-3 text-sm font-medium">Date</th>
                      <th className="text-left p-3 text-sm font-medium">By</th>
                      <th className="text-center p-3 text-sm font-medium">Before</th>
                      <th className="text-center p-3 text-sm font-medium">After</th>
                      <th className="text-center p-3 text-sm font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summaryData.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-muted-foreground">
                          No motor replacements recorded
                        </td>
                      </tr>
                    ) : (
                      summaryData.map(r => (
                        <tr 
                          key={r.id} 
                          className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                          onClick={() => setSelectedReplacement(r.id)}
                        >
                          <td className="p-3">{r.mlcMotor}</td>
                          <td className="p-3">{r.bank}</td>
                          <td className="p-3">{format(r.replacementDate, 'yyyy-MM-dd')}</td>
                          <td className="p-3 text-muted-foreground">{r.replacedBy}</td>
                          <td className="p-3 text-center">{r.beforeCount}</td>
                          <td className="p-3 text-center">{r.afterCount}</td>
                          <td className="p-3 text-center">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                              r.improvement > 0 
                                ? 'bg-green-500/10 text-green-600' 
                                : r.improvement < 0 
                                  ? 'bg-red-500/10 text-red-600' 
                                  : 'bg-muted text-muted-foreground'
                            }`}>
                              {r.improvement > 0 ? (
                                <TrendingDown className="w-3 h-3" />
                              ) : r.improvement < 0 ? (
                                <TrendingUp className="w-3 h-3" />
                              ) : null}
                              {r.improvement > 0 ? '+' : ''}{r.improvement}%
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

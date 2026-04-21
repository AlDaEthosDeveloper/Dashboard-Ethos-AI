import { MouseEvent, useMemo } from 'react';
import { format } from 'date-fns';
import { MLCError, MotorReplacement } from '@/data/mlcErrorData';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle, Minus, TrendingDown, TrendingUp, Wrench } from 'lucide-react';
import { MotorTrend } from '@/lib/mlcInsights';

interface MLCHeatmapProps {
  errors: MLCError[];
  replacements: MotorReplacement[];
  trendMap: Record<string, MotorTrend>;
  selectedMotors: Array<{ motor: number; bank: 'A' | 'B' }>;
  onMotorSelect: (selection: { motor: number; bank: 'A' | 'B' }, options?: { ctrlKey?: boolean; shiftKey?: boolean }) => void;
  showMotorErrorCounts: boolean;
  onShowMotorErrorCountsChange: (value: boolean) => void;
  showCountToggle?: boolean;
  showTrendIcons?: boolean;
  compactLegend?: boolean;
  compactCells?: boolean;
  title?: string;
  denseLayout?: boolean;
  splitBanks?: boolean;
}

export const MLCHeatmap = ({
  errors,
  replacements,
  trendMap,
  selectedMotors,
  onMotorSelect,
  showMotorErrorCounts,
  onShowMotorErrorCountsChange,
  showCountToggle = true,
  showTrendIcons = true,
  compactLegend = false,
  compactCells = false,
  title = 'MLC Motor Error Distribution',
  denseLayout = false,
  splitBanks = false,
}: MLCHeatmapProps) => {
  const motorCounts = useMemo(() => {
    const counts: Record<number, { total: number; bankA: number; bankB: number; hardA: number; hardB: number }> = {};
    for (let i = 1; i <= 57; i++) {
      counts[i] = { total: 0, bankA: 0, bankB: 0, hardA: 0, hardB: 0 };
    }
    errors.forEach(error => {
      if (counts[error.mlcMotor]) {
        counts[error.mlcMotor].total++;
        if (error.bank === 'A') {
          counts[error.mlcMotor].bankA++;
          if (error.isHardError) counts[error.mlcMotor].hardA++;
        } else {
          counts[error.mlcMotor].bankB++;
          if (error.isHardError) counts[error.mlcMotor].hardB++;
        }
      }
    });
    return counts;
  }, [errors]);

  // Get replacement info for each motor/bank
  const replacementMap = useMemo(() => {
    const map: Record<string, MotorReplacement[]> = {};
    replacements.forEach(r => {
      const key = `${r.mlcMotor}-${r.bank}`;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [replacements]);

  const maxCount = useMemo(() => {
    return Math.max(
      ...Object.values(motorCounts).map(c => Math.max(c.bankA, c.bankB)),
      1
    );
  }, [motorCounts]);

  const selectedMotorKeys = useMemo(
    () => new Set(selectedMotors.map(selection => `${selection.motor}-${selection.bank}`)),
    [selectedMotors]
  );

  const getHeatColor = (count: number, hasReplacement: boolean) => {
    if (hasReplacement) return 'ring-2 ring-purple-400';
    if (count === 0) return 'bg-surface';
    const intensity = count / maxCount;
    if (intensity < 0.25) return 'bg-success/30';
    if (intensity < 0.5) return 'bg-warning/40';
    if (intensity < 0.75) return 'bg-warning/70';
    return 'bg-danger';
  };

    

  const MotorCell = ({ motor, bank }: { motor: number; bank: 'A' | 'B' }) => {
    const data = motorCounts[motor];
    const count = bank === 'A' ? data.bankA : data.bankB;
    const hardCount = bank === 'A' ? data.hardA : data.hardB;
    const isSelected = selectedMotorKeys.has(`${motor}-${bank}`);

    const key = `${motor}-${bank}`;
    const motorReplacements = replacementMap[key] || [];

    const hasReplacement = motorReplacements.length > 0;
    const lastReplacement = motorReplacements.length
      ? motorReplacements[motorReplacements.length - 1].replacementDate
      : null;

      //  detect errors after replacement
    const oneDayAfterReplacement = lastReplacement
      ? new Date(lastReplacement.getTime() + 24 * 60 * 60 * 1000)
      : null;

    const hadErrorsAfterReplacement =
      !!oneDayAfterReplacement &&
      errors.some(
        e =>
          e.mlcMotor === motor &&
          e.bank === bank &&
          e.timestamp > oneDayAfterReplacement
      );

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(event: MouseEvent<HTMLButtonElement>) =>
              onMotorSelect(
                { motor, bank },
                { ctrlKey: event.ctrlKey || event.metaKey, shiftKey: event.shiftKey }
              )
            }
            className={`
              relative aspect-square rounded-sm text-[10px] font-medium transition-all
              ${getHeatColor(count, hasReplacement)}
              ${isSelected ? 'ring-2 ring-primary ring-offset-1 ring-offset-background scale-110 z-10' : ''}
              ${hadErrorsAfterReplacement ? 'ring-2 ring-red-500' : ''}
              ${count > 0 ? 'text-foreground hover:scale-105' : 'text-muted-foreground'}
              ${compactCells ? (denseLayout ? 'text-[10px] min-w-[13px] min-h-[13px]' : 'text-xs min-w-[18px] min-h-[18px]') : 'text-sm min-w-[24px] min-h-[24px]'}
              flex items-center justify-center
            `}
          >
            {showTrendIcons && trendMap[key] !== 'hidden' && (
              <span className="absolute left-0.5 top-0.5">
                {trendMap[key] === 'up' && <TrendingUp className="h-4 w-4 text-white-1000" />}
                {trendMap[key] === 'down' && <TrendingDown className="h-4 w-4  text-emerald-500" />}
                {trendMap[key] === 'stable' && <Minus className="h-3 w-3 text-slate-200" />}

              </span>
            )}
            <span>
              {motor}
              {showMotorErrorCounts && count > 0 && ((hadErrorsAfterReplacement && hasReplacement) || !hasReplacement) ? (
                <span className="ml-0.5 text-[10px] opacity-85">({count})</span>
              ) : null}
            </span>
          </button>
        </TooltipTrigger>

        <TooltipContent className="bg-popover border-border max-w-xs">
          <div className="space-y-1">
            <p className="font-semibold">Motor {motor} - Bank {bank}</p>
            <p className="text-sm text-muted-foreground">Total Errors: {count}</p>

            {hardCount > 0 && (
              <p className="text-sm text-danger">Hard Errors: {hardCount}</p>
            )}

            {hadErrorsAfterReplacement && (
              <p className="text-sm text-red-500">⚠ Errors occurred after last replacement</p>
            )}
            {showTrendIcons && trendMap[key] !== 'hidden' && (
              <p className="text-xs text-muted-foreground">
                Trend: {trendMap[key] === 'up' ? 'Increasing' : trendMap[key] === 'down' ? 'Decreasing' : trendMap[key] === 'stable' ? 'Stable' : 'Undetermined'}
              </p>
            )}

            {motorReplacements.length > 0 && (
              <div className="pt-2 border-t border-border mt-2">
                <p className="text-sm font-medium text-purple-400 flex items-center gap-1">
                  <Wrench className="w-3 h-3" /> Replaced:
                </p>
                {motorReplacements.map((r, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {format(r.replacementDate, 'MMM dd, yyyy')} by {r.replacedBy}
                  </p>
                ))}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className={denseLayout ? 'space-y-3' : 'space-y-6'}>
      <div className={`flex items-center justify-between flex-wrap ${denseLayout ? 'gap-2' : 'gap-4'}`}>
        <h3 className={`${denseLayout ? 'text-sm' : 'text-lg'} font-semibold text-foreground`}>{title}</h3>
        <div className={`flex items-center ${denseLayout ? 'gap-2' : 'gap-4'} text-sm flex-wrap`}>
          {showCountToggle ? (
            <label className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
              <input
                type="checkbox"
                checked={showMotorErrorCounts}
                onChange={(event) => onShowMotorErrorCountsChange(event.target.checked)}
              />
              <span className="text-xs text-muted-foreground">Show error count in motor label</span>
            </label>
          ) : null}
            <div>
              <div className={`flex items-center ${compactLegend ? 'gap-1 text-xs' : 'gap-2'}`}>
                <div className={`${compactLegend ? 'w-3 h-3' : 'w-4 h-4'} rounded bg-surface border border-border`} />
                <span className="text-muted-foreground">0</span>
                <div className={`${compactLegend ? 'w-3 h-3' : 'w-4 h-4'} rounded bg-success/30`} />
                <span className="text-muted-foreground">Low</span>
                <div className={`${compactLegend ? 'w-3 h-3' : 'w-4 h-4'} rounded bg-warning/70`} />
                <span className="text-muted-foreground">Med</span>
                <div className={`${compactLegend ? 'w-3 h-3' : 'w-4 h-4'} rounded bg-danger`} />
                <span className="text-muted-foreground">High</span>
                <div className={`${compactLegend ? 'w-3 h-3' : 'w-4 h-4'} rounded ring-2 ring-purple-400`} />
                <span className="text-muted-foreground">Replaced</span>
                {!compactLegend ? (
                  <>
                    <div className="w-4 h-4 rounded ring-2 ring-red-500" />
                    <span className="text-muted-foreground">Error after replacement</span>
                  </>
                ) : null}
              </div>
          </div>

        </div>
      </div>

      <div className={splitBanks ? 'flex flex-col gap-2 lg:flex-row lg:items-stretch' : 'space-y-2'}>
        {/* Bank A */}
        <div className={`${denseLayout ? 'space-y-1' : 'space-y-2'} ${splitBanks ? 'flex-1 rounded-md border border-cyan-700/50 bg-cyan-950/10 p-2' : ''}`}>
          <div className="flex items-center gap-2 rounded-sm bg-cyan-900/20 px-2 py-1">
            <div className="w-3 h-3 rounded-full bg-cyan-600" />
            <span className={`${compactCells ? 'text-xs' : 'text-sm'} font-semibold text-foreground`}>Bank A (Odd Error Codes)</span>
          </div>
          <div className={`grid grid-cols-19 ${compactCells ? (denseLayout ? 'gap-px' : 'gap-0.5') : 'gap-1'}`}>
            {Array.from({ length: 57 }, (_, i) => i + 1).map(motor => (
              <MotorCell key={`A-${motor}`} motor={motor} bank="A" />
            ))}
          </div>
        </div>

        {splitBanks ? <div className="hidden w-px self-stretch bg-border/80 lg:block" /> : null}

        {/* Bank B */}
        <div className={`${denseLayout ? 'space-y-1' : 'space-y-2'} ${splitBanks ? 'flex-1 rounded-md border border-lime-700/50 bg-lime-950/10 p-2' : ''}`}>
          <div className="flex items-center gap-2 rounded-sm bg-lime-900/20 px-2 py-1">
            <div className="w-3 h-3 rounded-full bg-lime-600" />
            <span className={`${compactCells ? 'text-xs' : 'text-sm'} font-semibold text-foreground`}>Bank B (Even Error Codes)</span>
          </div>
          <div className={`grid grid-cols-19 ${compactCells ? (denseLayout ? 'gap-px' : 'gap-0.5') : 'gap-1'}`}>
            {Array.from({ length: 57 }, (_, i) => i + 1).map(motor => (
              <MotorCell key={`B-${motor}`} motor={motor} bank="B" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

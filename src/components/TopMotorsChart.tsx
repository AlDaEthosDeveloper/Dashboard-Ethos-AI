import { useMemo } from 'react';
import { format } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from 'recharts';
import { MLCError, MotorReplacement } from '@/data/mlcErrorData';
import { Wrench } from 'lucide-react';

interface TopMotorsChartProps {
  errors: MLCError[];
  replacements: MotorReplacement[];
}

export const TopMotorsChart = ({ errors, replacements }: TopMotorsChartProps) => {
  // Get motors that have replacements
  const replacedMotors = useMemo(() => {
    const set = new Set<string>();
    replacements.forEach(r => {
      set.add(`${r.mlcMotor}-A`);
      set.add(`${r.mlcMotor}-B`);
    });
    return set;
  }, [replacements]);

  const chartData = useMemo(() => {
    const motorCounts: Record<number, { bankA: number; bankB: number; total: number }> = {};
    errors.forEach(error => {
      const key = `${error.mlcMotor}-${error.bank}`;
      if (replacedMotors.has(key)) {
        return;
      }

      if (!motorCounts[error.mlcMotor]) {
        motorCounts[error.mlcMotor] = { bankA: 0, bankB: 0, total: 0 };
      }

      motorCounts[error.mlcMotor].total++;
      if (error.bank === 'A') {
        motorCounts[error.mlcMotor].bankA++;
      } else {
        motorCounts[error.mlcMotor].bankB++;
      }
    });
    
    return Object.entries(motorCounts)
      .map(([motor, counts]) => {
        const motorNum = parseInt(motor);
        const hasReplacementA = replacedMotors.has(`${motorNum}-A`);
        const hasReplacementB = replacedMotors.has(`${motorNum}-B`);
        
        return { 
          motor: `Motor ${motor}`, 
          bankA: counts.bankA,
          bankB: counts.bankB,
          total: counts.total,
          motorNum,
          hasReplacementA,
          hasReplacementB,
          hasAnyReplacement: hasReplacementA || hasReplacementB,
        };
      })

      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [errors, replacedMotors]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const motorReplacements = replacements.filter(r => r.mlcMotor === data.motorNum);
      
      return (
        <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
          <p className="font-semibold text-foreground">{label}</p>
          <p className="text-sm text-chart-1">Bank A: {data.bankA} errors</p>
          <p className="text-sm text-chart-2">Bank B: {data.bankB} errors</p>
          <p className="text-sm text-muted-foreground">Total: {data.total}</p>
          
          {motorReplacements.length > 0 && (
            <div className="pt-2 mt-2 border-t border-border">

              {motorReplacements.map((r, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  Bank {r.bank}: {format(r.replacementDate, 'MMM dd, yyyy')} by {r.replacedBy}
                </p>
              ))}
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-card rounded-xl border border-border p-3 ">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium text-sm">Top 10 Problematic Motors (Bank A vs B)</h3>
        <div className="flex items-left gap-3 text-sm flex-wrap">
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-cyan-600" />
                <span className="text-sm font-medium text-sm">Bank A</span>
            </div>
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-lime-600" />
                <span className="text-sm font-medium text-sm">Bank B</span>
            </div>
        </div>


      </div>
      <div className="h-53">
        <ResponsiveContainer width="100%" height={190}>
          <BarChart data={chartData} layout="vertical" barCategoryGap="5%" barGap={1} margin={{ top: 0, right: 10, left: 5, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis 
              type="number"
              stroke="hsl(var(--muted-foreground))"
              fontSize={12}
              tickLine={false}
            />
            <YAxis 
              dataKey="motor" 
              type="category"
              interval={0}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={70}
              tick={({ x, y, payload }) => {
                const item = chartData.find(d => d.motor === payload.value);
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      x={0}
                      y={0}
                      dy={4}
                      textAnchor="end"
                      fill="hsl(var(--muted-foreground))"
                      fontSize={12}
                    >
                      {payload.value}
                    </text>
                    {item?.hasAnyReplacement && (
                      <circle cx={-65} cy={0} r={4} fill="hsl(270, 60%, 60%)" />
                    )}
                  </g>
                );
              }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="bankA"  fill="#0092b8" radius={[0, 0, 0, 0]} name="bankA" />
            <Bar dataKey="bankB" fill="#5ea500" radius={[0, 0, 0, 0]} name="bankB" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

import { useState, useEffect } from 'react';
import { Bell, BellRing, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { MLCError, MotorReplacement } from '@/data/mlcErrorData';
import { toast } from 'sonner';

interface AlertSettingsProps {
  errors: MLCError[];
  replacements: MotorReplacement[];
}

interface AlertConfig {
  enabled: boolean;
  threshold: number;
  periodDays: number;
}

const ALERT_STORAGE_KEY = 'mlc-alert-config';

/**
 * Retrieves data for `getDefaultConfig`.
 *
 * @param args Function input.
 * @returns Retrieved value.
 */
const getDefaultConfig = (): AlertConfig => ({
  enabled: true,
  threshold: 5,
  periodDays: 30,
});

/**
 * Executes `AlertSettings`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const AlertSettings = ({ errors, replacements }: AlertSettingsProps) => {
  const [config, setConfig] = useState<AlertConfig>(getDefaultConfig);
  const [hasAlerted, setHasAlerted] = useState<Set<string>>(new Set());

  // Load config from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ALERT_STORAGE_KEY);
      if (stored) {
        setConfig(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load alert config:', error);
    }
  }, []);

  // Save config to localStorage
  /**
   * Executes `updateConfig`.
   *
   * @param args Function input.
   * @returns Execution result.
   */
  const updateConfig = (updates: Partial<AlertConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(newConfig));
  };

  // Check for motors exceeding threshold
  useEffect(() => {
    if (!config.enabled || errors.length === 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.periodDays);

    // Count errors per motor in the period
    const motorCounts: Record<string, { count: number; motor: number; bank: 'A' | 'B' }> = {};
    
    errors.forEach(error => {
      if (error.timestamp >= cutoffDate) {
        const key = `${error.mlcMotor}-${error.bank}`;
        if (!motorCounts[key]) {
          motorCounts[key] = { count: 0, motor: error.mlcMotor, bank: error.bank };
        }
        motorCounts[key].count++;
      }
    });

    // Find motors exceeding threshold (excluding recently replaced)
    Object.entries(motorCounts).forEach(([key, data]) => {
      if (data.count >= config.threshold && !hasAlerted.has(key)) {
        // Check if motor was replaced recently
        const wasReplacedRecently = replacements.some(r => 
          r.mlcMotor === data.motor && 
          r.bank === data.bank &&
          r.replacementDate >= cutoffDate
        );

        if (!wasReplacedRecently) {
          toast.warning(
            `Motor ${data.motor} (Bank ${data.bank}) has ${data.count} errors in the last ${config.periodDays} days`,
            {
              description: 'Consider checking this motor for issues',
              duration: 10000,
            }
          );
          setHasAlerted(prev => new Set(prev).add(key));
        }
      }
    });
  }, [errors, replacements, config, hasAlerted]);

  // Get current alert count
  /**
   * Retrieves data for `getExceedingMotors`.
   *
   * @param args Function input.
   * @returns Retrieved value.
   */
  const getExceedingMotors = () => {
    if (!config.enabled) return [];
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - config.periodDays);

    const motorCounts: Record<string, { count: number; motor: number; bank: 'A' | 'B' }> = {};
    
    errors.forEach(error => {
      if (error.timestamp >= cutoffDate) {
        const key = `${error.mlcMotor}-${error.bank}`;
        if (!motorCounts[key]) {
          motorCounts[key] = { count: 0, motor: error.mlcMotor, bank: error.bank };
        }
        motorCounts[key].count++;
      }
    });

    return Object.values(motorCounts)
      .filter(data => data.count >= config.threshold)
      .filter(data => {
        // Exclude recently replaced
        return !replacements.some(r => 
          r.mlcMotor === data.motor && 
          r.bank === data.bank &&
          r.replacementDate >= cutoffDate
        );
      })
      .sort((a, b) => b.count - a.count);
  };

  const exceedingMotors = getExceedingMotors();
  const hasAlerts = exceedingMotors.length > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button 
          variant={hasAlerts ? "destructive" : "outline"} 
          size="sm" 
          className="gap-2 relative"
        >
          {hasAlerts ? (
            <BellRing className="w-4 h-4" />
          ) : (
            <Bell className="w-4 h-4" />
          )}
          Alerts
          {hasAlerts && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
              {exceedingMotors.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Alert Settings
            </h4>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => updateConfig({ enabled })}
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="threshold">Error Threshold</Label>
              <Input
                id="threshold"
                type="number"
                min={1}
                max={100}
                value={config.threshold}
                onChange={(e) => updateConfig({ threshold: parseInt(e.target.value) || 5 })}
                disabled={!config.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Alert when a motor exceeds this many errors
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="period">Time Period (days)</Label>
              <Input
                id="period"
                type="number"
                min={1}
                max={365}
                value={config.periodDays}
                onChange={(e) => updateConfig({ periodDays: parseInt(e.target.value) || 30 })}
                disabled={!config.enabled}
              />
              <p className="text-xs text-muted-foreground">
                Count errors within this time window
              </p>
            </div>
          </div>

          {exceedingMotors.length > 0 && (
            <div className="pt-3 border-t border-border">
              <h5 className="text-sm font-medium mb-2 text-destructive">
                Motors Exceeding Threshold
              </h5>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {exceedingMotors.map(motor => (
                  <div 
                    key={`${motor.motor}-${motor.bank}`}
                    className="text-sm flex justify-between items-center py-1 px-2 rounded bg-destructive/10"
                  >
                    <span>Motor {motor.motor} (Bank {motor.bank})</span>
                    <span className="font-medium text-destructive">{motor.count} errors</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

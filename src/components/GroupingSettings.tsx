import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface GroupingSettingsProps {
  groupingWindowSeconds: number;
  onGroupingWindowChange: (seconds: number) => void;
}

/**
 * Executes `GroupingSettings`.
 *
 * @param args Function input.
 * @returns Execution result.
 */
export const GroupingSettings = ({
  groupingWindowSeconds,
  onGroupingWindowChange,
}: GroupingSettingsProps) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="w-4 h-4" />
          Grouping: {groupingWindowSeconds}s
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start">
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-2">Error Grouping Settings</h4>
            <p className="text-xs text-muted-foreground">
              Errors on the same motor within this time window are grouped as "hard errors".
            </p>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="grouping-window">Time Window (seconds)</Label>
            <Input
              id="grouping-window"
              type="number"
              min="5"
              max="300"
              value={groupingWindowSeconds}
              onChange={(e) => {
                const value = parseInt(e.target.value);
                if (!isNaN(value) && value >= 5 && value <= 300) {
                  onGroupingWindowChange(value);
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Range: 5-300 seconds
            </p>
          </div>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGroupingWindowChange(15)}
              className={groupingWindowSeconds === 15 ? 'ring-2 ring-primary' : ''}
            >
              15s
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGroupingWindowChange(30)}
              className={groupingWindowSeconds === 30 ? 'ring-2 ring-primary' : ''}
            >
              30s
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onGroupingWindowChange(60)}
              className={groupingWindowSeconds === 60 ? 'ring-2 ring-primary' : ''}
            >
              60s
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

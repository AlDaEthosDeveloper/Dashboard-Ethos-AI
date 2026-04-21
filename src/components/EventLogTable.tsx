import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { Trash2, ChevronDown, ChevronRight, Info, AlertTriangle, XCircle, AlertOctagon, Search, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GenericEvent } from '@/data/genericEventData';
import { EventLogType, EVENT_LOG_TYPE_LABELS } from '@/data/eventLogTypes';
import { cn } from '@/lib/utils';

interface EventLogTableProps {
  events: GenericEvent[];
  logType: EventLogType;
  onClear: () => void;
}

const SeverityIcon = ({ severity }: { severity: GenericEvent['severity'] }) => {
  switch (severity) {
    case 'Critical':
      return <AlertOctagon className="h-4 w-4 text-red-500" />;
    case 'Error':
      return <XCircle className="h-4 w-4 text-destructive" />;
    case 'Warning':
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    default:
      return <Info className="h-4 w-4 text-blue-500" />;
  }
};

const SeverityBadge = ({ severity }: { severity: GenericEvent['severity'] }) => {
  const variants: Record<GenericEvent['severity'], string> = {
    Critical: 'bg-red-500/20 text-red-500 border-red-500/30',
    Error: 'bg-destructive/20 text-destructive border-destructive/30',
    Warning: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
    Info: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  };

  return (
    <Badge variant="outline" className={cn('text-xs', variants[severity])}>
      {severity}
    </Badge>
  );
};

export const EventLogTable = ({ events, logType, onClear }: EventLogTableProps) => {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [componentFilter, setComponentFilter] = useState<string>('all');
  const pageSize = 50;

  // Get unique components for filter dropdown
  const uniqueComponents = useMemo(() => {
    const components = new Set(events.map(e => e.component).filter(Boolean));
    return Array.from(components).sort();
  }, [events]);

  // Filter events based on search and filters
  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch = 
          event.component?.toLowerCase().includes(query) ||
          event.description?.toLowerCase().includes(query) ||
          event.eventCode?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      
      // Severity filter
      if (severityFilter !== 'all' && event.severity !== severityFilter) {
        return false;
      }
      
      // Component filter
      if (componentFilter !== 'all' && event.component !== componentFilter) {
        return false;
      }
      
      return true;
    });
  }, [events, searchQuery, severityFilter, componentFilter]);

  const sortedEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [filteredEvents]);

  const paginatedEvents = useMemo(() => {
    return sortedEvents.slice(page * pageSize, (page + 1) * pageSize);
  }, [sortedEvents, page]);

  const totalPages = Math.ceil(filteredEvents.length / pageSize);
  
  const hasActiveFilters = searchQuery || severityFilter !== 'all' || componentFilter !== 'all';
  
  const clearFilters = () => {
    setSearchQuery('');
    setSeverityFilter('all');
    setComponentFilter('all');
    setPage(0);
  };

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No {EVENT_LOG_TYPE_LABELS[logType]} events found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Filter Bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search component, description, code..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[180px]">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="Critical">Critical</SelectItem>
            <SelectItem value="Fault">Fault</SelectItem>
            <SelectItem value="Error">Error</SelectItem>
            <SelectItem value="Warning">Warning</SelectItem>
            <SelectItem value="Info">Info</SelectItem>
          </SelectContent>
        </Select>
        
        {uniqueComponents.length > 0 && (
          <Select value={componentFilter} onValueChange={(v) => { setComponentFilter(v); setPage(0); }}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Component" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Faults</SelectItem>
              {uniqueComponents.map(comp => (
                <SelectItem key={comp} value={comp}>{comp}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}
      </div>
      
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {paginatedEvents.length} of {filteredEvents.length} events
          {hasActiveFilters && ` (${events.length} total)`}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="gap-2 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
          Clear {EVENT_LOG_TYPE_LABELS[logType].split(' ')[0]}
        </Button>
      </div>

      <div className="rounded-md border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Component</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Code</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedEvents.map(event => (
              <>
                <TableRow
                  key={event.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleRow(event.id)}
                >
                  <TableCell className="p-2">
                    {expandedRows.has(event.id) ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {format(event.timestamp, 'yyyy-MM-dd HH:mm:ss')}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <SeverityIcon severity={event.severity} />
                      <SeverityBadge severity={event.severity} />
                    </div>
                  </TableCell>
                  <TableCell className="font-medium break-words whitespace-normal">{event.component}</TableCell>
                  <TableCell className="max-w-[24rem] break-words whitespace-normal" title={event.description}>
                    {event.description || '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.eventCode}</TableCell>
                </TableRow>
                {expandedRows.has(event.id) && event.rawData && (
                  <TableRow key={`${event.id}-details`}>
                    <TableCell colSpan={6} className="bg-muted/30 p-4">
                      <div className="text-sm space-y-2">
                        <p className="font-medium text-foreground">Raw Data:</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                          {Object.entries(event.rawData).map(([key, value]) => (
                            <div key={key} className="bg-background rounded px-2 py-1">
                              <span className="text-muted-foreground">{key}:</span>{' '}
                              <span className="font-mono">{value}</span>
                            </div>
                          ))}
                        </div>
                        {event.data1 !== undefined && (
                          <p className="text-muted-foreground">
                            Data1: <span className="font-mono">{event.data1}</span>
                            {event.data2 !== undefined && (
                              <span className="ml-4">Data2: <span className="font-mono">{event.data2}</span></span>
                            )}
                          </p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};

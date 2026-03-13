/**
 * Sync scheduling: Run syncs at specific times or intervals
 */
export type ScheduleType = 'interval' | 'cron' | 'on-demand';
export type CronParseResult = {
    minute?: number[];
    hour?: number[];
    dayOfMonth?: number[];
};
export interface SyncSchedule {
    type: ScheduleType;
    name: string;
    enabled: boolean;
    intervalMs?: number;
    cronExpression?: string;
    lastRunTime?: number;
    nextRunTime?: number;
    metadata?: Record<string, any>;
}
/**
 * Simple cron expression parser (supports basic patterns)
 * Format: "0 0 * * *" -> minute hour day month dayOfWeek
 * Supports: asterisk, numbers, ranges (1-5), steps (every 5: `*` slash `5`)
 */
export declare class SimpleCronParser {
    static parse(cronExpr: string): CronParseResult | null;
    private static parseField;
    /**
     * Check if current time matches cron expression
     */
    static matches(cronExpr: string, now?: Date): boolean;
}
/**
 * Sync scheduler: Manages scheduled sync operations
 */
export declare class SyncScheduler {
    private schedules;
    private timers;
    private onSyncCallback;
    /**
     * Create an interval-based schedule
     */
    addIntervalSchedule(name: string, intervalMs: number): void;
    /**
     * Create a cron-based schedule
     */
    addCronSchedule(name: string, cronExpression: string): void;
    /**
     * Start scheduler
     */
    start(onSync: (scheduleName: string) => Promise<void>): void;
    /**
     * Stop all scheduled tasks
     */
    stop(): void;
    /**
     * Enable/disable a schedule
     */
    setEnabled(name: string, enabled: boolean): void;
    /**
     * Get all schedules
     */
    getSchedules(): SyncSchedule[];
    /**
     * Get schedule status
     */
    getStatus(name: string): SyncSchedule | null;
    /**
     * Trigger a manual sync for a schedule
     */
    triggerManual(name: string): Promise<void>;
    /**
     * Internal: Schedule a task
     */
    private scheduleTask;
    /**
     * Calculate next run time for cron expression
     */
    private calculateNextCronTime;
}
//# sourceMappingURL=scheduler.d.ts.map
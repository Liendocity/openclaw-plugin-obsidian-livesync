/**
 * Sync scheduling: Run syncs at specific times or intervals
 */

export type ScheduleType = 'interval' | 'cron' | 'on-demand';
export type CronParseResult = { minute?: number[]; hour?: number[]; dayOfMonth?: number[] };

export interface SyncSchedule {
  type: ScheduleType;
  name: string;
  enabled: boolean;
  intervalMs?: number; // For interval type
  cronExpression?: string; // For cron type (simple subset)
  lastRunTime?: number;
  nextRunTime?: number;
  metadata?: Record<string, any>;
}

/**
 * Simple cron expression parser (supports basic patterns)
 * Format: "0 0 * * *" -> minute hour day month dayOfWeek
 * Supports: asterisk, numbers, ranges (1-5), steps (every 5: `*` slash `5`)
 */
export class SimpleCronParser {
  static parse(cronExpr: string): CronParseResult | null {
    const parts = cronExpr.trim().split(/\s+/);
    if (parts.length < 5) {
      console.warn(`Invalid cron expression: ${cronExpr}`);
      return null;
    }

    return {
      minute: this.parseField(parts[0], 0, 59) ?? undefined,
      hour: this.parseField(parts[1], 0, 23) ?? undefined,
      dayOfMonth: this.parseField(parts[2], 1, 31) ?? undefined
    };
  }

  private static parseField(field: string, min: number, max: number): number[] | null {
    if (field === '*') {
      return Array.from({ length: max - min + 1 }, (_, i) => i + min);
    }

    if (field.includes(',')) {
      // Comma-separated list
      return field
        .split(',')
        .flatMap(part => this.parseField(part, min, max) || []);
    }

    if (field.includes('-')) {
      // Range
      const [start, end] = field.split('-').map(Number);
      if (start >= min && end <= max && start <= end) {
        return Array.from({ length: end - start + 1 }, (_, i) => i + start);
      }
    }

    if (field.includes('/')) {
      // Step
      const [base, step] = field.split('/');
      const stepNum = Number(step);
      if (base === '*') {
        const result = [];
        for (let i = min; i <= max; i += stepNum) {
          result.push(i);
        }
        return result;
      }
    }

    // Single number
    const num = Number(field);
    if (!isNaN(num) && num >= min && num <= max) {
      return [num];
    }

    return null;
  }

  /**
   * Check if current time matches cron expression
   */
  static matches(cronExpr: string, now: Date = new Date()): boolean {
    const parsed = this.parse(cronExpr);
    if (!parsed) return false;

    const minute = now.getMinutes();
    const hour = now.getHours();
    const dayOfMonth = now.getDate();

    return (
      (parsed.minute?.includes(minute) ?? false) &&
      (parsed.hour?.includes(hour) ?? false) &&
      (parsed.dayOfMonth?.includes(dayOfMonth) ?? false)
    );
  }
}

/**
 * Sync scheduler: Manages scheduled sync operations
 */
export class SyncScheduler {
  private schedules: Map<string, SyncSchedule> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private onSyncCallback: ((scheduleName: string) => Promise<void>) | null = null;

  /**
   * Create an interval-based schedule
   */
  addIntervalSchedule(name: string, intervalMs: number) {
    this.schedules.set(name, {
      type: 'interval',
      name,
      enabled: true,
      intervalMs,
      lastRunTime: 0,
      nextRunTime: Date.now() + intervalMs
    });
  }

  /**
   * Create a cron-based schedule
   */
  addCronSchedule(name: string, cronExpression: string) {
    // Validate cron
    if (!SimpleCronParser.parse(cronExpression)) {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }

    this.schedules.set(name, {
      type: 'cron',
      name,
      enabled: true,
      cronExpression,
      lastRunTime: 0,
      nextRunTime: this.calculateNextCronTime(cronExpression)
    });
  }

  /**
   * Start scheduler
   */
  start(onSync: (scheduleName: string) => Promise<void>) {
    this.onSyncCallback = onSync;

    for (const [name, schedule] of this.schedules) {
      this.scheduleTask(name, schedule);
    }

    console.log(`[Scheduler] Started with ${this.schedules.size} schedule(s)`);
  }

  /**
   * Stop all scheduled tasks
   */
  stop() {
    for (const [name, timer] of this.timers) {
      clearTimeout(timer);
      clearInterval(timer as any);
    }
    this.timers.clear();
    console.log('[Scheduler] Stopped all schedules');
  }

  /**
   * Enable/disable a schedule
   */
  setEnabled(name: string, enabled: boolean) {
    const schedule = this.schedules.get(name);
    if (schedule) {
      schedule.enabled = enabled;
      console.log(`[Scheduler] Schedule "${name}" ${enabled ? 'enabled' : 'disabled'}`);
    }
  }

  /**
   * Get all schedules
   */
  getSchedules(): SyncSchedule[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get schedule status
   */
  getStatus(name: string) {
    return this.schedules.get(name) || null;
  }

  /**
   * Trigger a manual sync for a schedule
   */
  async triggerManual(name: string) {
    const schedule = this.schedules.get(name);
    if (!schedule || !this.onSyncCallback) {
      return;
    }

    schedule.lastRunTime = Date.now();
    if (schedule.type === 'interval') {
      schedule.nextRunTime = Date.now() + (schedule.intervalMs || 0);
    } else if (schedule.type === 'cron') {
      schedule.nextRunTime = this.calculateNextCronTime(schedule.cronExpression || '');
    }

    try {
      await this.onSyncCallback(name);
    } catch (err) {
      console.error(`[Scheduler] Error executing schedule "${name}":`, err);
    }
  }

  /**
   * Internal: Schedule a task
   */
  private scheduleTask(name: string, schedule: SyncSchedule) {
    if (schedule.type === 'interval' && schedule.intervalMs) {
      // Set up interval
      const timer = setInterval(async () => {
        if (!schedule.enabled || !this.onSyncCallback) return;

        try {
          schedule.lastRunTime = Date.now();
          schedule.nextRunTime = Date.now() + schedule.intervalMs!;
          await this.onSyncCallback(name);
        } catch (err) {
          console.error(`[Scheduler] Error in schedule "${name}":`, err);
        }
      }, schedule.intervalMs);

      this.timers.set(name, timer as any);
    } else if (schedule.type === 'cron' && schedule.cronExpression) {
      // Set up cron-like scheduling (check every minute)
      const timer = setInterval(async () => {
        if (!schedule.enabled || !this.onSyncCallback) return;

        if (SimpleCronParser.matches(schedule.cronExpression!)) {
          try {
            schedule.lastRunTime = Date.now();
            schedule.nextRunTime = this.calculateNextCronTime(schedule.cronExpression!);
            await this.onSyncCallback(name);
          } catch (err) {
            console.error(`[Scheduler] Error in schedule "${name}":`, err);
          }
        }
      }, 60000); // Check every minute

      this.timers.set(name, timer as any);
    }
  }

  /**
   * Calculate next run time for cron expression
   */
  private calculateNextCronTime(cronExpr: string): number {
    const parsed = SimpleCronParser.parse(cronExpr);
    if (!parsed) return 0;

    let next = new Date();
    next.setSeconds(0);
    next.setMilliseconds(0);
    
    // Increment by 1 minute until we find a match
    // (Up to 1 month to avoid infinite loops)
    const limit = new Date(next);
    limit.setMonth(limit.getMonth() + 1);

    while (next < limit) {
      next.setMinutes(next.getMinutes() + 1);
      if (SimpleCronParser.matches(cronExpr, next)) {
        return next.getTime();
      }
    }

    return 0; // No match found in reasonable time
  }
}

import { ConflictStrategy } from './conflict';
interface SyncAuditLog {
    timestamp: number;
    action: 'sync_file' | 'pull_vault' | 'error';
    path?: string;
    status: 'success' | 'error';
    message: string;
    scope?: string;
}
export default class ObsidianLiveSyncPlugin {
    private db;
    private config;
    private vaultSettings;
    private hasher;
    private logger;
    private scopeValidator;
    private pbkdf2Salt;
    private watcher;
    private conflictResolver;
    private versionManager;
    private fileMetadataCache;
    private mergeStrategy;
    private incrementalSyncManager;
    private syncScheduler;
    private autoMergeEnabled;
    constructor(config: any);
    initialize(): Promise<void>;
    /**
     * P1: Start automatic file watcher
     */
    startAutoWatch(): Promise<void>;
    /**
     * P1: Handle file changes from watcher
     */
    private onFilesChanged;
    /**
     * P1: Stop file watcher
     */
    stopAutoWatch(): Promise<void>;
    /**
     * Tool: Sync a file to CouchDB con validación de scope y manejo de errores robusto
     */
    obsidian_sync_file({ filePath }: {
        filePath: string;
    }): Promise<{
        success: boolean;
        message: string;
        chunks: number;
        bytes: number;
    }>;
    /**
     * Tool: Descargar vault completo desde CouchDB
     * Respeta scope: cada agente solo puede escribir en su carpeta
     */
    obsidian_pull_vault(): Promise<{
        success: boolean;
        message: string;
        decryptedChunks: number;
        filesWritten: number;
        filesSkipped: number;
    }>;
    /**
     * Obtener historial de auditoría (para debugging y monitoreo)
     */
    getAuditLog(): SyncAuditLog[];
    /**
     * P1: Get file version history
     */
    getVersionHistory({ filePath }: {
        filePath: string;
    }): Promise<{
        success: boolean;
        path: string;
        version: any;
        mtime: any;
        versions: any;
        message?: never;
    } | {
        success: boolean;
        message: string;
        path?: never;
        version?: never;
        mtime?: never;
        versions?: never;
    }>;
    /**
     * P1: Revert to a previous version
     */
    revertToVersion({ filePath, versionNumber }: {
        filePath: string;
        versionNumber: number;
    }): Promise<{
        success: boolean;
        message: string;
        newVersion: any;
    }>;
    /**
     * P1: Set conflict resolution strategy
     */
    setConflictStrategy(strategy: ConflictStrategy): void;
    /**
     * P1: Get watcher status
     */
    getWatcherStatus(): {
        watching: any;
        pendingChanges: any;
    };
    /**
     * P2: Initialize incremental sync
     */
    private initIncrementalSync;
    /**
     * P2: Get next batch of files to sync (incremental)
     */
    getNextSyncBatch(): Promise<{
        success: boolean;
        message: string;
        files?: never;
        summary?: never;
    } | {
        success: boolean;
        files: any;
        summary: any;
        message?: never;
    }>;
    /**
     * P2: Sync a batch of files
     */
    syncBatch({ files }: {
        files: string[];
    }): Promise<{
        synced: string[];
        failed: {
            path: string;
            error: string;
        }[];
        skipped: string[];
    }>;
    /**
     * P2: Merge two versions intelligently
     */
    mergeConflict({ filePath, localContent, remoteContent, baseContent }: {
        filePath: string;
        localContent: string;
        remoteContent: string;
        baseContent?: string;
    }): Promise<{
        success: boolean;
        merged: string;
        hasConflicts: boolean;
    }>;
    /**
     * P2: Setup sync schedules
     */
    private setupSchedules;
    /**
     * P2: Handle scheduled sync
     */
    private onScheduledSync;
    /**
     * P2: Get list of schedules
     */
    getSchedules(): any;
    /**
     * P2: Add a new sync schedule
     */
    addSchedule({ name, type, intervalMs, cronExpression }: {
        name: string;
        type: 'interval' | 'cron';
        intervalMs?: number;
        cronExpression?: string;
    }): {
        success: boolean;
        error?: never;
    } | {
        success: boolean;
        error: any;
    };
    /**
     * P2: Enable/disable a schedule
     */
    setScheduleEnabled(name: string, enabled: boolean): {
        success: boolean;
    };
    /**
     * P2: Trigger manual sync for a schedule
     */
    triggerSchedule(name: string): Promise<{
        success: boolean;
    }>;
    /**
     * P2: Stop scheduler
     */
    stopScheduler(): {
        success: boolean;
    };
    /**
     * P2: Get incremental sync stats
     */
    getIncrementalSyncStats(): {
        enabled: boolean;
        stats?: never;
    } | {
        enabled: boolean;
        stats: any;
    };
    /**
     * P2: Reset incremental sync tracking
     */
    resetIncrementalSyncTracking(): {
        success: boolean;
        message: string;
    } | {
        success: boolean;
        message?: never;
    };
}
export {};
//# sourceMappingURL=index.d.ts.map
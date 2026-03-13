/**
 * Incremental sync: Only sync files that have changed since last sync
 * Dramatically improves performance for large vaults
 */
export interface SyncState {
    lastSyncTime: number;
    fileHashes: Map<string, string>;
    fileTimestamps: Map<string, number>;
}
export interface ChangeSummary {
    added: string[];
    modified: string[];
    deleted: string[];
    unchanged: string[];
    totalFiles: number;
}
/**
 * Track file changes for incremental sync
 */
export declare class ChangeTracker {
    private syncState;
    private stateFile;
    constructor(workspaceRoot: string);
    /**
     * Scan workspace and detect changes
     */
    detectChanges(scannedFiles: Map<string, {
        hash: string;
        mtime: number;
    }>): ChangeSummary;
    /**
     * Update state after successful sync
     */
    updateState(scannedFiles: Map<string, {
        hash: string;
        mtime: number;
    }>): void;
    /**
     * Mark specific files as synced
     */
    markSynced(filePaths: string[]): void;
    /**
     * Get files that need syncing
     */
    getChangedFiles(maxFiles?: number): string[];
    /**
     * Get last sync time
     */
    getLastSyncTime(): number;
    /**
     * Clear state (reset to full sync)
     */
    reset(): void;
    /**
     * Load state from disk
     */
    private loadState;
    /**
     * Save state to disk
     */
    private saveState;
}
/**
 * Incremental sync manager
 * Batches changes and syncs efficiently
 */
export declare class IncrementalSyncManager {
    private tracker;
    private batchSize;
    private lastBatchTime;
    private minBatchDelayMs;
    constructor(workspaceRoot: string, batchSize?: number, minBatchDelayMs?: number);
    /**
     * Get next batch of files to sync
     * Respects batch size and delay
     */
    getNextBatch(): {
        files: string[];
        summary: ChangeSummary;
    } | null;
    /**
     * Mark batch as synced
     */
    markBatchSynced(files: string[]): void;
    /**
     * Get sync statistics
     */
    getStats(): {
        lastSyncTime: number;
        nextSyncEligible: number;
    };
    /**
     * Reset tracking (force full sync)
     */
    reset(): void;
}
//# sourceMappingURL=incremental.d.ts.map
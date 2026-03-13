/**
 * File watcher for automatic synchronization
 */
export interface WatcherOptions {
    /** Directories to watch (relative to workspace root) */
    watched?: string[];
    /** Ignore patterns (e.g., node_modules, .git) */
    ignored?: string[];
    /** Debounce delay in milliseconds */
    debounceMs?: number;
    /** Enable initial file scan */
    persistent?: boolean;
}
export interface FileChangeEvent {
    event: 'add' | 'change' | 'unlink';
    filePath: string;
    timestamp: number;
    hash?: string;
}
/**
 * File system watcher with debouncing
 */
export declare class WorkspaceWatcher {
    private workspaceRoot;
    private options;
    private watcher;
    private debounceTimers;
    private changeQueue;
    private onChangeCallback;
    private watching;
    constructor(workspaceRoot: string, options?: WatcherOptions);
    /**
     * Start watching for file changes
     */
    start(onChange: (events: FileChangeEvent[]) => Promise<void>): Promise<void>;
    /**
     * Stop watching
     */
    stop(): Promise<void>;
    /**
     * Internal: handle file change with debouncing
     */
    private onFileChange;
    /**
     * Process file change and queue for callback
     */
    private processFileChange;
    /**
     * Compute hash of file content
     */
    private computeHash;
    /**
     * Flush queued changes to callback
     */
    private flushChanges;
    /**
     * Get current watch status
     */
    isWatching(): boolean;
    /**
     * Get pending changes
     */
    getPendingChanges(): FileChangeEvent[];
}
//# sourceMappingURL=watcher.d.ts.map
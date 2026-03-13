/**
 * File watcher for automatic synchronization
 */
import chokidar from 'chokidar';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
/**
 * File system watcher with debouncing
 */
export class WorkspaceWatcher {
    workspaceRoot;
    options;
    watcher = null;
    debounceTimers = new Map();
    changeQueue = [];
    onChangeCallback = null;
    watching = false;
    constructor(workspaceRoot, options = {}) {
        this.workspaceRoot = workspaceRoot;
        this.options = options;
        this.options.watched = this.options.watched || ['100', '101', '102', '103', '104']; // Sky scopes
        this.options.ignored = this.options.ignored || [
            '**/node_modules',
            '**/.git',
            '**/.obsidian',
            '**/dist',
            '**/build',
            '**/.env',
            '**/*.tmp'
        ];
        this.options.debounceMs = this.options.debounceMs || 500;
        this.options.persistent = this.options.persistent !== false;
    }
    /**
     * Start watching for file changes
     */
    async start(onChange) {
        if (this.watching) {
            console.warn('[Watcher] Already watching');
            return;
        }
        this.onChangeCallback = onChange;
        const watchPatterns = this.options.watched.map(scope => path.join(this.workspaceRoot, `${scope}/**`));
        this.watcher = chokidar.watch(watchPatterns, {
            ignored: this.options.ignored,
            persistent: this.options.persistent,
            ignoreInitial: true, // Don't trigger on initial scan
            awaitWriteFinish: {
                stabilityThreshold: 200,
                pollInterval: 100
            }
        });
        this.watcher
            .on('add', (filePath) => this.onFileChange('add', filePath))
            .on('change', (filePath) => this.onFileChange('change', filePath))
            .on('unlink', (filePath) => this.onFileChange('unlink', filePath))
            .on('error', (err) => console.error('[Watcher] Error:', err))
            .on('ready', () => {
            this.watching = true;
            console.log('[Watcher] Watching for changes:', this.options.watched);
        });
    }
    /**
     * Stop watching
     */
    async stop() {
        if (this.watcher) {
            await this.watcher.close();
            this.watcher = null;
            this.watching = false;
            console.log('[Watcher] Stopped');
        }
    }
    /**
     * Internal: handle file change with debouncing
     */
    onFileChange(event, filePath) {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        // Clear existing debounce timer for this file
        if (this.debounceTimers.has(relativePath)) {
            clearTimeout(this.debounceTimers.get(relativePath));
        }
        // Debounce: wait a bit before processing
        const timer = setTimeout(() => {
            this.processFileChange(event, relativePath, filePath);
            this.debounceTimers.delete(relativePath);
        }, this.options.debounceMs);
        this.debounceTimers.set(relativePath, timer);
    }
    /**
     * Process file change and queue for callback
     */
    processFileChange(event, relativePath, fullPath) {
        try {
            const changeEvent = {
                event,
                filePath: relativePath,
                timestamp: Date.now()
            };
            // Compute hash if file still exists
            if ((event === 'add' || event === 'change') && fs.existsSync(fullPath)) {
                changeEvent.hash = this.computeHash(fullPath);
            }
            this.changeQueue.push(changeEvent);
            // Flush queue if debounce period is over
            if (this.changeQueue.length > 0) {
                this.flushChanges();
            }
        }
        catch (err) {
            console.error(`[Watcher] Error processing ${relativePath}:`, err);
        }
    }
    /**
     * Compute hash of file content
     */
    computeHash(filePath) {
        try {
            const content = fs.readFileSync(filePath);
            return crypto.createHash('sha256').update(content).digest('hex');
        }
        catch {
            return '';
        }
    }
    /**
     * Flush queued changes to callback
     */
    async flushChanges() {
        if (this.changeQueue.length === 0 || !this.onChangeCallback)
            return;
        const events = [...this.changeQueue];
        this.changeQueue = [];
        try {
            await this.onChangeCallback(events);
        }
        catch (err) {
            console.error('[Watcher] Callback error:', err);
        }
    }
    /**
     * Get current watch status
     */
    isWatching() {
        return this.watching;
    }
    /**
     * Get pending changes
     */
    getPendingChanges() {
        return [...this.changeQueue];
    }
}
//# sourceMappingURL=watcher.js.map
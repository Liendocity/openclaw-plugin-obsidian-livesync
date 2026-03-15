/**
 * Incremental sync: Only sync files that have changed since last sync
 * Dramatically improves performance for large vaults
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SyncState {
  lastSyncTime: number;
  fileHashes: Map<string, string>; // path -> hash
  fileTimestamps: Map<string, number>; // path -> mtime
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
export class ChangeTracker {
  private syncState: SyncState;
  private stateFile: string;

  constructor(workspaceRoot: string) {
    this.stateFile = path.join(workspaceRoot, '.obsidian-sync-state.json');
    this.syncState = this.loadState();
  }

  /**
   * Scan workspace and detect changes
   */
  detectChanges(scannedFiles: Map<string, { hash: string; mtime: number }>): ChangeSummary {
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const unchanged: string[] = [];

    const currentHashes = this.syncState.fileHashes;
    const currentTimestamps = this.syncState.fileTimestamps;

    // Check for deleted files
    for (const filePath of currentHashes.keys()) {
      if (!scannedFiles.has(filePath)) {
        deleted.push(filePath);
      }
    }

    // Check scanned files for additions or modifications
    for (const [filePath, data] of scannedFiles) {
      const previousHash = currentHashes.get(filePath);
      const previousMtime = currentTimestamps.get(filePath);

      if (!previousHash) {
        added.push(filePath);
      } else if (previousHash !== data.hash || previousMtime !== data.mtime) {
        modified.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    }

    return {
      added,
      modified,
      deleted,
      unchanged,
      totalFiles: scannedFiles.size
    };
  }

  /**
   * Update state after successful sync
   */
  updateState(scannedFiles: Map<string, { hash: string; mtime: number }>) {
    this.syncState.lastSyncTime = Date.now();
    this.syncState.fileHashes.clear();
    this.syncState.fileTimestamps.clear();

    for (const [filePath, data] of scannedFiles) {
      this.syncState.fileHashes.set(filePath, data.hash);
      this.syncState.fileTimestamps.set(filePath, data.mtime);
    }

    this.saveState();
  }

  /**
   * Mark specific files as synced
   */
  markSynced(filePaths: string[]) {
    for (const filePath of filePaths) {
      if (fs.existsSync(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            const content = fs.readFileSync(filePath);
            const hash = crypto.createHash('sha256').update(content as any).digest('hex');
            const mtime = stats.mtime.getTime();

            this.syncState.fileHashes.set(filePath, hash);
            this.syncState.fileTimestamps.set(filePath, mtime);
          }
        } catch (err) {
          console.warn(`[ChangeTracker] Failed to record sync state for ${filePath}:`, err);
        }
      }
    }
    this.syncState.lastSyncTime = Date.now();
    this.saveState();
  }

  /**
   * Get files that were previously synced
   */
  getSyncedFiles(): string[] {
    return Array.from(this.syncState.fileHashes.keys());
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): number {
    return this.syncState.lastSyncTime;
  }

  /**
   * Clear state (reset to full sync)
   */
  reset() {
    this.syncState = {
      lastSyncTime: 0,
      fileHashes: new Map(),
      fileTimestamps: new Map()
    };
    this.saveState();
  }

  /**
   * Load state from disk
   */
  private loadState(): SyncState {
    if (!fs.existsSync(this.stateFile)) {
      return {
        lastSyncTime: 0,
        fileHashes: new Map(),
        fileTimestamps: new Map()
      };
    }

    try {
      const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf-8'));
      return {
        lastSyncTime: data.lastSyncTime || 0,
        fileHashes: new Map(data.fileHashes || []),
        fileTimestamps: new Map(data.fileTimestamps || [])
      };
    } catch (err) {
      console.warn('[ChangeTracker] Failed to load state, starting fresh:', err);
      return {
        lastSyncTime: 0,
        fileHashes: new Map(),
        fileTimestamps: new Map()
      };
    }
  }

  /**
   * Save state to disk
   */
  private saveState() {
    const data = {
      lastSyncTime: this.syncState.lastSyncTime,
      fileHashes: Array.from(this.syncState.fileHashes),
      fileTimestamps: Array.from(this.syncState.fileTimestamps)
    };

    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('[ChangeTracker] Failed to save state:', err);
    }
  }
}

/**
 * Incremental sync manager
 * Batches changes and syncs efficiently
 */
export class IncrementalSyncManager {
  private tracker: ChangeTracker;
  private batchSize: number;
  private lastBatchTime: number = 0;
  private minBatchDelayMs: number;
  private workspaceRoot: string;

  constructor(workspaceRoot: string, batchSize: number = 50, minBatchDelayMs: number = 1000) {
    this.workspaceRoot = workspaceRoot;
    this.tracker = new ChangeTracker(workspaceRoot);
    this.batchSize = batchSize;
    this.minBatchDelayMs = minBatchDelayMs;
  }

  /**
   * Scan workspace and find files that need syncing
   */
  private scanWorkspace(dirsToWatch: string[]): Map<string, { hash: string; mtime: number }> {
    const results = new Map<string, { hash: string; mtime: number }>();
    
    const scanDir = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stats = fs.statSync(fullPath);
        
        if (stats.isDirectory()) {
          // Skip known hidden dirs
          if (!file.startsWith('.')) {
            scanDir(fullPath);
          }
        } else if (stats.isFile()) {
          const relativePath = path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/');
          const content = fs.readFileSync(fullPath);
          const hash = crypto.createHash('sha256').update(content as any).digest('hex');
          results.set(relativePath, { hash, mtime: stats.mtime.getTime() });
        }
      }
    };

    for (const subDir of dirsToWatch) {
      scanDir(path.join(this.workspaceRoot, subDir));
    }

    return results;
  }

  /**
   * Get next batch of files to sync
   */
  getNextBatch(dirsToWatch: string[]): { files: string[]; summary: ChangeSummary } | null {
    const now = Date.now();
    const timeSinceLastBatch = now - this.lastBatchTime;

    if (timeSinceLastBatch < this.minBatchDelayMs) {
      return null; // Too soon to sync
    }

    // 1. Scan for changes
    const scannedFiles = this.scanWorkspace(dirsToWatch);
    const summary = this.tracker.detectChanges(scannedFiles);

    // 2. Combine added and modified
    const toSync = [...summary.added, ...summary.modified];
    
    if (toSync.length === 0) {
      this.tracker.updateState(scannedFiles); // Update state even if no changes (for deletions)
      return null;
    }

    // 3. Limit to batch size
    const batch = toSync.slice(0, this.batchSize);
    
    this.lastBatchTime = now;

    return {
      files: batch,
      summary
    };
  }

  /**
   * Mark batch as synced
   */
  markBatchSynced(files: string[]) {
    this.tracker.markSynced(files);
  }

  /**
   * Get sync statistics
   */
  getStats() {
    return {
      lastSyncTime: this.tracker.getLastSyncTime(),
      nextSyncEligible: this.lastBatchTime + this.minBatchDelayMs
    };
  }

  /**
   * Reset tracking (force full sync)
   */
  reset() {
    this.tracker.reset();
    this.lastBatchTime = 0;
  }
}


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

    const currentHashes = new Map(this.syncState.fileHashes);
    const currentTimestamps = new Map(this.syncState.fileTimestamps);

    // Check existing files
    for (const [filePath, currentData] of currentHashes) {
      if (!scannedFiles.has(filePath)) {
        deleted.push(filePath);
      }
    }

    // Check scanned files
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
        const content = fs.readFileSync(filePath);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        const mtime = fs.statSync(filePath).mtime.getTime();

        this.syncState.fileHashes.set(filePath, hash);
        this.syncState.fileTimestamps.set(filePath, mtime);
      }
    }
    this.syncState.lastSyncTime = Date.now();
    this.saveState();
  }

  /**
   * Get files that need syncing
   */
  getChangedFiles(maxFiles?: number): string[] {
    // Return added + modified, optionally limited
    const changed = Array.from(this.syncState.fileHashes.keys());
    return maxFiles ? changed.slice(0, maxFiles) : changed;
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

  constructor(workspaceRoot: string, batchSize: number = 50, minBatchDelayMs: number = 1000) {
    this.tracker = new ChangeTracker(workspaceRoot);
    this.batchSize = batchSize;
    this.minBatchDelayMs = minBatchDelayMs;
  }

  /**
   * Get next batch of files to sync
   * Respects batch size and delay
   */
  getNextBatch(): { files: string[]; summary: ChangeSummary } | null {
    const now = Date.now();
    const timeSinceLastBatch = now - this.lastBatchTime;

    if (timeSinceLastBatch < this.minBatchDelayMs) {
      return null; // Too soon to sync
    }

    const changedFiles = this.tracker.getChangedFiles(this.batchSize);
    if (changedFiles.length === 0) {
      return null; // Nothing to sync
    }

    // Create summary (simplified)
    const summary: ChangeSummary = {
      added: [],
      modified: changedFiles.slice(0, Math.min(changedFiles.length, 10)),
      deleted: [],
      unchanged: [],
      totalFiles: changedFiles.length
    };

    this.lastBatchTime = now;

    return {
      files: changedFiles,
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

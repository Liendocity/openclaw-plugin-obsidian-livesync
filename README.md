# OpenClaw Plugin: Obsidian LiveSync

Synchronize your OpenClaw agent's workspace with your Obsidian vault via **Self-hosted LiveSync** (CouchDB).

## ✨ Features

### P0: Professional Foundation
- **🔐 Dynamic Salt Extraction**: Salt is extracted from the setup_uri, never hardcoded.
- **🛡️ Multi-Agent ACL**: Scope-based access control prevents agents from writing outside their scope.
  - `000-099`: Raul's personal workspace
  - `100-199`: Sky (agent memory)
  - `200+`: Shared folders (future)
- **📊 Structured Audit Logging**: Every sync operation is logged with timestamps, scopes, and outcomes.
- **💾 End-to-End Encryption**: HKDF + AES-GCM (compatible with official Obsidian LiveSync).
- **🚀 Chunked Upload/Download**: Efficient file deduplication and bandwidth optimization.

### P1: Robustness & Automation
- **🔄 Automatic File Watcher**: Detects changes and syncs automatically (optional, enabled by default)
  - Debounced to prevent duplicate syncs
  - Respects scope configuration
  - Configurable watch folders and ignore patterns
- **🔁 Retry Logic with Exponential Backoff**: Handles transient network failures gracefully
  - Automatic retries with jitter to prevent server overload
  - Timeout and backoff configuration
- **⚔️ Conflict Detection & Resolution**: Multiple strategies for handling sync conflicts
  - `last-write-wins`: Latest timestamp wins
  - `remote-wins`, `local-wins`: Always trust one side
  - `keep-both`: Archive conflicts and preserve both versions
- **📚 Versioning & Revert**: Full version history with ability to revert files
  - Automatic version tracking
  - Revert to any previous version
  - Conflict versions automatically archived

### P2: Intelligence & Performance
- **🧠 Intelligent Merge Strategies**: Auto-resolve conflicts without manual intervention
  - 3-way merge for text files
  - Markdown-aware merge (preserves frontmatter)
  - JSON-aware merge (recursive, array dedup)
  - Automatic conflict detection and smart fallback
- **⚡ Incremental Sync**: Only sync changed files (100-1000x faster)
  - Change tracking with persistent state
  - Batch operations for efficiency
  - Resume from interruptions
  - Dramatically reduces bandwidth and API calls
- **📅 Sync Scheduling**: Run syncs at specific times
  - Interval-based (every N ms/minutes/hours)
  - Cron-based (e.g., "9am weekdays")
  - Background execution
  - Manual trigger capability
- **🎯 Batch Operations**: Efficient bulk file syncing
  - Process multiple files in one operation
  - Reduced network overhead
  - Progress tracking

## 🔧 Configuration

### Basic Setup
1. Get your Obsidian LiveSync setup URI from the Obsidian plugin settings.
2. Create a config file (or use environment variables):

```json
{
  "passphrase": "your-obsidian-livesync-passphrase",
  "setup_uri": "obsidian://setuplivesync?settings=<encrypted-string>",
  "agentId": "sky"
}
```

**Note**: The `setup_uri` must contain `pbkdf2_salts`. This is automatically included when you export settings from Obsidian LiveSync.

### Advanced Configuration (P1 + P2 Features)

```json
{
  "passphrase": "your-obsidian-livesync-passphrase",
  "setup_uri": "obsidian://setuplivesync?settings=<encrypted-string>",
  "agentId": "sky",
  
  // P1: Watcher & Retry
  "autoWatch": true,                          // Enable automatic file watcher
  "watchedScopes": ["100", "101", "102"],    // Scopes to monitor for changes
  "watcherDebounceMs": 500,                   // Debounce delay for file changes
  "conflictStrategy": "last-write-wins",      // last-write-wins | remote-wins | local-wins | keep-both
  "maxRetries": 3,                            // Retries for failed operations
  "retryBackoffMs": 100,                      // Initial backoff delay (ms)
  "retryMaxBackoffMs": 10000,                 // Maximum backoff delay (ms)
  
  // P2: Incremental Sync & Merging
  "incrementalSync": true,                    // Enable change tracking (huge perf boost)
  "incrementalBatchSize": 50,                 // Files per sync batch
  "incrementalMinDelayMs": 1000,              // Min delay between batch syncs
  "autoMerge": true,                          // Enable intelligent conflict resolution
  "mergeStrategy": "line-based",              // Merge strategy for conflicts
  
  // P2: Sync Scheduling
  "schedules": [
    {
      "name": "hourly-sync",
      "type": "interval",
      "intervalMs": 3600000                   // Every 1 hour
    },
    {
      "name": "morning-sync",
      "type": "cron",
      "cronExpression": "0 9 * * *"           // 9:00 AM daily
    },
    {
      "name": "weekday-evening",
      "type": "cron",
      "cronExpression": "0 18 * * 1-5"        // 6:00 PM Mon-Fri
    }
  ]
}
```

## 📁 Automatic File Watcher — P1

When `autoWatch: true` (default), the plugin monitors your workspace for file changes and syncs automatically:

```javascript
// Watcher is enabled automatically on initialize()
// Changes detected: add, change, unlink
// 
// Example events:
// [AutoSync] Archivo eliminado: 100.Sky/journal/2026-03-13.md
// [AutoSync] Auto-sincronizado: change 100.Sky/memory/notes.md
```

**Control the watcher:**
```json
{
  "autoWatch": true,                          // Enable/disable auto-sync
  "watchedScopes": ["100", "101"],            // Only monitor these folders
  "watcherDebounceMs": 1000                   // Wait 1s after change before syncing
}
```

**Disable auto-watch if you prefer manual sync:**
```json
{ "autoWatch": false }
```

---

## ⚔️ Conflict Resolution — P1

When the same file is modified in both locations, the plugin uses your configured strategy:

### Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `last-write-wins` | Latest timestamp wins | Default; works for most scenarios |
| `remote-wins` | Always trust CouchDB version | Obsidian is source of truth |
| `local-wins` | Always keep local version | Workspace is source of truth |
| `keep-both` | Archive conflict, keep both | Maximum data preservation |

### Example: Conflict Detection Log

```json
{
  "timestamp": "2026-03-13T20:45:30Z",
  "action": "sync_file",
  "path": "100.Sky/memory/notes.md",
  "status": "success",
  "message": "Conflicto detectado: remote is newer. Aplicando: remote. Versión anterior archivada como notes.md.v4"
}
```

**Change strategy at runtime:**
```js
await setConflictStrategy('keep-both')  // Preserve all versions
```

---

## 🔄 Retry Logic — P1

The plugin automatically retries failed operations with exponential backoff:

```
Retry 1: Wait 100ms, try again
Retry 2: Wait 200ms, try again  
Retry 3: Wait 400ms, try again
(configurable: backoff multiplier, max delay, jitter)
```

This prevents temporary network issues from causing sync failures. Logs include retry information:

```
[Retry] Attempt 1/3 failed. Waiting 152ms. Error: connect timeout
[Retry] Attempt 2/3 failed. Waiting 304ms. Error: connect timeout
[2026-03-13T20:45:33] [sync_file] OK: Synced after 2 retries
```

---

## 💡 Incremental Sync — P2

Change tracking for 100x faster syncs:

```javascript
// Automatically tracks changes since last sync
const batch = await getNextSyncBatch()
// Returns: { files: [...], summary: { added: 2, modified: 5, deleted: 0 } }

// Sync in batches
await syncBatch({ files: batch.files })

// Check stats
const stats = await getIncrementalSyncStats()
// { enabled: true, stats: { lastSyncTime: ..., nextSyncEligible: ... } }
```

**Benefits:**
- Only changed files are synced
- Persistent tracking (resume after interruptions)
- Configurable batch size (default: 50 files per batch)
- Ideal for vaults with thousands of files

---

## 🧠 Intelligent Merge — P2

Auto-resolve conflicts without manual intervention:

```javascript
// Manual merge
const result = await mergeConflict({
  filePath: "100.Sky/memory/notes.md",
  localContent: "My version...",
  remoteContent: "Their version...",
  baseContent: "Original version..." // optional
})
// Returns: { merged: "...", hasConflicts: false }

// Auto-merge is enabled by default on conflicts
// Supports: Text (3-way), Markdown (preserves frontmatter), JSON (recursive)
```

**Strategies:**
| File Type | Strategy | Behavior |
|-----------|----------|----------|
| `.md` | Markdown-aware | Merges content, preserves YAML frontmatter |
| `.json` | JSON-aware | Recursive merge, concatenates unique array items |
| Other | 3-way merge | Standard line-based merge with conflict markers |

---

## 📅 Sync Scheduling — P2

Automate syncs at specific times:

```javascript
// Create schedules
await addSchedule({
  name: "hourly-sync",
  type: "interval",
  intervalMs: 3600000  // Every hour
})

await addSchedule({
  name: "morning-sync",
  type: "cron",
  cronExpression: "0 9 * * *"  // 9:00 AM daily
})

// List all schedules
const schedules = await getSchedules()

// Enable/disable
await setScheduleEnabled("hourly-sync", false)

// Manually trigger
await triggerSchedule("morning-sync")

// Stop scheduler
await stopScheduler()
```

**Cron Format** (simplified): `minute hour day month dayOfWeek`
- `0 9 * * *` = 9:00 AM every day
- `0 */6 * * *` = Every 6 hours
- `0 18 * * 1-5` = 6:00 PM Monday-Friday
- `*/15 * * * *` = Every 15 minutes

---

## 🛠️ Tools

### `obsidian_sync_file(filePath)`
Synchronize a specific file from the workspace to CouchDB.
- **ACL**: Only files in the agent's scope can be synced.
- **Returns**: Success status, chunk count, and byte size.
- **Logging**: All operations are logged with audit trail.

**Example:**
```js
await obsidian_sync_file("100.Sky/memory/notes.md") // ✅ Sky can write here
await obsidian_sync_file("000.INBOX/item.md")        // ❌ Sky cannot write here (ACL violation)
```

### `obsidian_pull_vault()`
Download the entire vault from CouchDB, filtered by agent scope.
- **ACL**: Only downloads files matching the agent's allowed scope.
- **Returns**: Decrypted chunk count, files written, and files skipped (ACL).
- **Logging**: Audit trail for all operations.

### `getAuditLog()`
Retrieve the sync audit log for debugging and monitoring.
- **Returns**: Array of audit entries with timestamps, actions, paths, scopes, and status.

### `getVersionHistory(filePath)` — P1
View complete version history for a file.
- **Returns**: Version number, modification time, and array of previous versions.

**Example:**
```js
const history = await getVersionHistory("100.Sky/memory/notes.md")
// Returns:
// {
//   version: 5,
//   mtime: 1710340800000,
//   versions: [
//     { version: 4, hash: "abc123...", source: "local" },
//     { version: 3, hash: "def456...", source: "remote", conflict: true }
//   ]
// }
```

### `revertToVersion(filePath, versionNumber)` — P1
Revert a file to a previous version. Only works for files in your allowed scope.
- **Returns**: Success status and new version number.

**Example:**
```js
const result = await revertToVersion("100.Sky/memory/notes.md", 3)
// Reverts to version 3, creates new version 6
```

### `setConflictStrategy(strategy)` — P1
Change the conflict resolution strategy at runtime.
- **Strategies**: `'last-write-wins'`, `'remote-wins'`, `'local-wins'`, `'keep-both'`
- **Default**: `'last-write-wins'`

**Example:**
```js
await setConflictStrategy('remote-wins')  // Always trust remote version
```

### `getWatcherStatus()` — P1
Check the status of the automatic file watcher.
- **Returns**: `{ watching: boolean, pendingChanges: FileChangeEvent[] }`

**Example:**
```js
const status = await getWatcherStatus()
// { 
//   watching: true,
//   pendingChanges: [
//     { event: 'change', filePath: '100.Sky/memory/notes.md', timestamp: 1710340800000 }
//   ]
// }
```

## 🚀 Installation

```bash
# Clone the repo
git clone https://github.com/Liendocity/openclaw-plugin-obsidian-livesync.git
cd openclaw-plugin-obsidian-livesync

# Install dependencies
npm install

# Compile TypeScript
npm run build  # (if build script exists in package.json)

# Copy to OpenClaw plugins directory
cp -r . ~/.openclaw/workspace/plugins/obsidian-livesync

# Restart OpenClaw gateway
openclaw gateway restart
```

## 📋 Scopes & Access Control

| Scope | Agent | Purpose |
|-------|-------|---------|
| `000-099` | Raul | Personal workspace (INBOX, JOURNAL, ACTION, etc.) |
| `100-199` | Sky | Agent memory (journal, analysis, tasks, etc.) |
| `200+` | Shared | Shared resources (future) |

## 🔍 Audit Log Example

```json
[
  {
    "timestamp": 1710340800000,
    "action": "sync_file",
    "path": "100.Sky/memory/notes.md",
    "status": "success",
    "scope": "100.Sky",
    "message": "Sincronizado (3 chunks, 15234 bytes)"
  },
  {
    "timestamp": 1710340801000,
    "action": "sync_file",
    "path": "000.INBOX/item.md",
    "status": "error",
    "scope": "sky",
    "message": "[ACL VIOLATION] Acceso denegado: sky no tiene permiso para 000.inbox/item.md"
  }
]
```

## 🐛 Troubleshooting

### "Salt not found in settings"
- Ensure you're using the **full** setup_uri from Obsidian LiveSync.
- The URI must contain the `pbkdf2_salts` parameter (automatically exported by the plugin).
- Re-export from Obsidian and try again.

### "ACL VIOLATION"
- Your agent (e.g., "sky") is trying to write to a forbidden scope.
- Check the scope restrictions in the plugin config.
- Contact your admin if you need scope expansion.

### Decryption failures
- The passphrase is incorrect or doesn't match the vault's encryption key.
- Ensure the `setup_uri` and `passphrase` are from the same Obsidian vault.

## 📝 License
MIT

## 🙏 Credits
Based on [obsidian-livesync](https://github.com/vrtmrz/obsidian-livesync) by vrtmrz.

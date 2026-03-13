# Changelog

## [2.0.0-p1] - 2026-03-13

### 🚀 P1 Features: Robustness & Automation

#### File Watcher & Auto-Sync
- **[NEW]** `WorkspaceWatcher` class with chokidar integration
  - Automatic file change detection (add, change, unlink)
  - Debouncing to prevent duplicate syncs
  - Respects scope configuration (000+, 100+, etc.)
  - Configurable watched folders and ignore patterns
- **[NEW]** Automatic sync on file changes (optional, enabled by default)
  - Set `autoWatch: false` to disable
  - Configurable debounce delay
  - Auto-sync logged separately for audit trail

#### Retry Logic with Exponential Backoff
- **[NEW]** `retryWithBackoff()` utility with configurable parameters
  - Exponential backoff to prevent overwhelming the server
  - Jitter to avoid thundering herd problem
  - Custom `RetryableError` for error context
- **[NEW]** Safe wrapper functions for PouchDB operations
  - `safeDbPut()`, `safeDbGet()`, `safeDbAllDocs()`
  - Automatic retry on transient failures (network timeouts, etc.)
  - Reduces sync failures from temporary network issues

#### Conflict Resolution & Versioning
- **[NEW]** `ConflictResolver` class with multiple strategies
  - `last-write-wins` (default): Latest timestamp wins
  - `remote-wins`: Always trust remote version
  - `local-wins`: Always keep local version
  - `keep-both`: Archive conflicts and keep both versions
- **[NEW]** `VersionManager` for tracking file versions
  - Automatic version bumping on sync
  - Version history stored with each file
  - Ability to revert to previous versions
- **[NEW]** Conflict detection during sync
  - Compares hashes and timestamps
  - Automatically archives old versions
  - Logs conflict resolution decisions

#### New Tools
- **`getVersionHistory(filePath)`**: View version history and metadata
- **`revertToVersion(filePath, versionNumber)`**: Restore previous version (respects ACL)
- **`setConflictStrategy(strategy)`**: Change resolution strategy at runtime
- **`getWatcherStatus()`**: Check file watcher status and pending changes

#### Code Quality & Testing
- **[NEW]** TypeScript interfaces for Watcher and Conflict types
- **[NEW]** Basic test suite with `test/*.test.ts`
  - Retry logic tests (success, failure, backoff timing)
  - Conflict resolution tests (strategies, detection, versioning)
  - Run with: `npm test`
- **[IMPROVED]** Package.json scripts
  - `npm run build`: Compile TypeScript
  - `npm run watch`: Watch mode for development
  - `npm test`: Run test suite

#### Configuration Updates
- New optional config parameter: `conflictStrategy` (default: 'last-write-wins')
- New optional config parameter: `autoWatch` (default: true)
- New optional config parameter: `watchedScopes` (default: ['100', '101', '102', '103', '104'])
- New optional config parameter: `watcherDebounceMs` (default: 500)

### 📝 Documentation
- Updated README with P1 features
- Added troubleshooting for conflict scenarios
- Detailed version management examples

### ✅ P1 Checklist Complete

- [x] File watcher for automatic sync
- [x] Retry logic with exponential backoff
- [x] Conflict detection and resolution
- [x] Versioning and revert capabilities
- [x] Multiple conflict strategies
- [x] Basic test suite
- [x] Documentation updates

### 📌 Next Steps (P2 & Beyond)

- [ ] Merge strategies for intelligent conflict resolution
- [ ] Incremental sync (only changed files/chunks)
- [ ] Sync scheduling (cron-style intervals)
- [ ] Better error recovery (offline mode, queue)
- [ ] Performance: parallel chunk uploads/downloads
- [ ] Full integration tests with real CouchDB
- [ ] CI/CD pipeline with automated testing

---

## [2.0.0-p0] - 2026-03-13

### ✨ P0 Professional Improvements

#### Security & Compliance
- **[CRITICAL FIX]** Salt no longer hardcoded in source code
  - Salt now extracted dynamically from `setup_uri`
  - Eliminates security risk of embedding vault-specific secrets
  - Validates salt presence during initialization

#### Access Control (ACL)
- **[NEW]** Multi-agent scope validation
  - `ScopeValidator` class enforces folder-based access control
  - Prevents agents from reading/writing outside assigned scopes
  - Configurable per-agent scopes: Raul (000-099), Sky (100-199), Shared (200+)
  - ACL violations logged and thrown as errors

#### Observability & Logging
- **[NEW]** Structured audit logging system
  - `StructuredLogger` class with timestamped operations
  - All sync operations logged with: timestamp, action, path, scope, status, message
  - Audit trail retained in memory (max 1000 entries)
  - `getAuditLog()` tool for debugging and compliance

#### Code Quality
- **[NEW]** TypeScript interfaces for better type safety
  - `VaultSettings`, `SyncAuditLog` interfaces
  - Full type hints on logger and validator classes
- **[IMPROVED]** Error handling
  - Granular error catching per operation (chunking, writing, etc.)
  - Contextual error messages with agent info
  - No silent failures; all errors logged before throwing
- **[IMPROVED]** Documentation
  - Detailed README with troubleshooting
  - `CONFIG.EXAMPLE.json` for easy setup
  - Audit log examples in documentation

### 🚀 Refactored Methods

#### `initialize()`
- Now validates `pbkdf2_salts` in decrypted settings
- Stores salt in `this.pbkdf2Salt` for reuse
- Better error messages on initialization failure

#### `obsidian_sync_file()`
- **NEW**: ACL validation before file access
- **NEW**: Audit logging with chunk/byte counts
- **IMPROVED**: Returns detailed info (chunks, bytes)
- **IMPROVED**: Error handling per chunk with context

#### `obsidian_pull_vault()`
- **NEW**: ACL filtering during pull (skip files outside scope)
- **NEW**: Audit logging for each file operation
- **NEW**: Skipped file counts in response
- **IMPROVED**: Better error context per file

### 📋 Configuration Changes

- `openclaw.plugin.json` v2.0.0-p0
  - New optional `agentId` parameter (defaults to "sky")
  - Updated description and repository URL
  - New `notes` section documenting improvements and scopes

### 🔄 Migration Notes

- **Backward Compatible**: Existing setups still work
- **Breaking Change**: Hardcoded salt removed; all vaults must use setup_uri with pbkdf2_salts
- **Recommended**: Update any hardcoded configs to use `setup_uri`

### ✅ Checklist: P0 Complete

- [x] Salt extraction (dynamic)
- [x] Multi-agent ACL
- [x] Structured logging + audit trail
- [x] Error handling improvements
- [x] Type safety (TypeScript)
- [x] Documentation updates

### 📌 Next Steps (P1 & Beyond)

- [ ] File watcher for automatic sync on local changes
- [ ] Conflict resolution strategy (merge, versioning, etc.)
- [ ] Retry logic with exponential backoff
- [ ] Batch operations for performance
- [ ] Unit tests + integration tests
- [ ] CI/CD pipeline

---

## [1.0.0] - Initial Release

- Basic sync functionality
- Support for chunked uploads/downloads
- E2E encryption compatible with Obsidian LiveSync

# Changelog

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

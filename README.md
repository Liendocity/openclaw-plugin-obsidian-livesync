# OpenClaw Plugin: Obsidian LiveSync

Synchronize your OpenClaw agent's workspace with your Obsidian vault via **Self-hosted LiveSync** (CouchDB).

## ✨ Features

### P0 Professional Improvements
- **🔐 Dynamic Salt Extraction**: Salt is extracted from the setup_uri, never hardcoded.
- **🛡️ Multi-Agent ACL**: Scope-based access control prevents agents from writing outside their scope.
  - `000-099`: Raul's personal workspace
  - `100-199`: Sky (agent memory)
  - `200+`: Shared folders (future)
- **📊 Structured Audit Logging**: Every sync operation is logged with timestamps, scopes, and outcomes.
- **💾 End-to-End Encryption**: HKDF + AES-GCM (compatible with official Obsidian LiveSync).
- **🚀 Chunked Upload/Download**: Efficient file deduplication and bandwidth optimization.

## 🔧 Configuration

### Setup
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

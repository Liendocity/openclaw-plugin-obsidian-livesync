# OpenClaw Plugin: Obsidian LiveSync

This plugin allows your OpenClaw agent to synchronize files from its workspace directly into your Obsidian vault via the **Self-hosted LiveSync** protocol (CouchDB).

## Features
- **Direct Sync**: Send any file from the workspace to CouchDB.
- **End-to-End Encryption**: Uses the same HKDF + AES-GCM encryption as the official Obsidian plugin.
- **Deduplication**: Chunks files to save space and bandwidth.

## Configuration
Add the following to your OpenClaw configuration:

```json
{
  "couchdb_url": "https://your-couchdb-url/database",
  "username": "your_username",
  "password": "your_password",
  "passphrase": "your_livesync_passphrase",
  "salt": "your_livesync_salt_base64"
}
```

## Tools
- `obsidian_sync_file(filePath)`: Synchronizes the specified file to the vault.

## Installation
Copy this folder into your OpenClaw plugins directory and restart the gateway.
```bash
npm install
```

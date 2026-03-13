# Installation Guide

Complete step-by-step instructions for installing and configuring the OpenClaw Obsidian LiveSync Plugin.

---

## Prerequisites

- **OpenClaw** running on your system (Linux/macOS/Windows)
- **Obsidian** installed with **Self-hosted LiveSync** plugin
- **CouchDB** instance running (typically on your NAS or local server)
- Network access from both machines to CouchDB

---

## Step 1: Prepare Obsidian Setup URI

### From Obsidian (on your computer)

1. Open **Obsidian** → **Settings** → **Self-hosted LiveSync**
2. In the setup section, find **"Export settings as QR code"**
3. Click **"Show as text"** (if QR is displayed)
4. Copy the full `obsidian://setuplivesync?settings=...` URI
5. **Save this somewhere safe** (you'll need it in Step 3)

**Important:** This URI contains your encrypted CouchDB credentials and salt.

---

## Step 2: Clone & Build

### On your development machine or NAS:

```bash
# Clone the repository
git clone https://github.com/Liendocity/openclaw-plugin-obsidian-livesync.git
cd openclaw-plugin-obsidian-livesync

# Install dependencies
npm install

# Compile TypeScript → JavaScript
npm run build

# (Optional) Run tests to verify everything works
npm test
```

**Expected output:**
```
✅ All tests passed
dist/ folder created with compiled .js files
```

---

## Step 3: Find Your Passphrase

From your **Obsidian Self-hosted LiveSync** settings:

1. Go to **Settings** → **Self-hosted LiveSync** → **Security**
2. Find your **Encryption Passphrase**
3. **Copy and save it** (needed for OpenClaw config)

---

## Step 4: Copy Plugin to OpenClaw

### Option A: If running on NAS/Docker

```bash
# From NAS or mounted location
cp -r dist/ ~/.openclaw/workspace/plugins/obsidian-livesync/
cp openclaw.plugin.json ~/.openclaw/workspace/plugins/obsidian-livesync/
cp CONFIG.EXAMPLE.json ~/.openclaw/workspace/plugins/obsidian-livesync/config.json
```

### Option B: If running locally

```bash
# From development machine
cp -r dist/ ~/.openclaw/workspace/plugins/obsidian-livesync/
cp openclaw.plugin.json ~/.openclaw/workspace/plugins/obsidian-livesync/
cp CONFIG.EXAMPLE.json ~/.openclaw/workspace/plugins/obsidian-livesync/config.json
```

---

## Step 5: Configure the Plugin

### Create configuration file

Create or edit `~/.openclaw/workspace/plugins/obsidian-livesync/config.json`:

```json
{
  "passphrase": "YOUR_ENCRYPTION_PASSPHRASE_HERE",
  "setup_uri": "obsidian://setuplivesync?settings=YOUR_FULL_URI_HERE",
  "agentId": "sky"
}
```

**Replace:**
- `YOUR_ENCRYPTION_PASSPHRASE_HERE` → Your Obsidian passphrase from Step 3
- `YOUR_FULL_URI_HERE` → The full obsidian:// URI from Step 1

### (Optional) Advanced Configuration

For more control, edit the config.json:

```json
{
  "passphrase": "...",
  "setup_uri": "...",
  "agentId": "sky",
  
  // Auto file watcher
  "autoWatch": true,
  "watchedScopes": ["100", "101", "102"],
  "watcherDebounceMs": 500,
  
  // Incremental sync (recommended)
  "incrementalSync": true,
  "incrementalBatchSize": 50,
  "incrementalMinDelayMs": 1000,
  
  // Auto-merge conflicts
  "autoMerge": true,
  "conflictStrategy": "last-write-wins",
  
  // Scheduled syncs (optional)
  "schedules": [
    {
      "name": "hourly-sync",
      "type": "interval",
      "intervalMs": 3600000
    }
  ]
}
```

---

## Step 6: Restart OpenClaw

```bash
openclaw gateway restart
```

Or manually:

```bash
openclaw gateway stop
openclaw gateway start
```

---

## Step 7: Verify Installation

### Check plugin loaded

```bash
openclaw plugins list
```

You should see `obsidian-livesync` in the list with version `2.0.0`.

### Test sync manually

In OpenClaw, try:

```javascript
// List your schedules
const schedules = await getSchedules()
console.log(schedules)

// Get audit log (should be empty initially)
const log = await getAuditLog()
console.log(log)

// Try pulling vault from CouchDB
const result = await obsidian_pull_vault()
console.log(result)
```

---

## Step 8: Configure Scopes (Optional)

If you want to use different agent scopes, modify `config.json`:

```json
{
  "agentId": "sky",
  "watchedScopes": ["100", "101", "102", "103", "104"]
}
```

- **000-099**: Raul (personal workspace)
- **100-199**: Sky (agent memory)
- **200+**: Shared (future)

---

## Troubleshooting

### Plugin doesn't load

```bash
# Check if files are in right place
ls -la ~/.openclaw/workspace/plugins/obsidian-livesync/

# Verify config.json is valid JSON
cat ~/.openclaw/workspace/plugins/obsidian-livesync/config.json | jq .

# Check OpenClaw logs
tail -f ~/.openclaw/logs/gateway.log
```

### "Salt not found in settings"

- The `setup_uri` is incomplete or wrong
- Re-export from Obsidian Settings → LiveSync → "Export as text"
- Make sure you copy the entire URI (starts with `obsidian://`)

### "Invalid passphrase"

- Passphrase doesn't match the one in Obsidian
- Check for extra spaces or special characters
- Re-copy from Obsidian: **Settings** → **Self-hosted LiveSync** → **Security**

### Files not syncing

- Check auto-watch is enabled: `getWatcherStatus()`
- Verify scope: `watchedScopes` in config includes your folder (e.g., `100`)
- Check audit log: `getAuditLog()`
- Try manual sync: `obsidian_sync_file("100.Sky/test.md")`

### CouchDB connection timeout

- Verify CouchDB is running and accessible
- Check network connectivity from your machine to NAS/server
- Verify `setup_uri` has correct CouchDB URL

---

## Next Steps

1. **Enable auto-sync** in Obsidian LiveSync settings on your computer
2. **Create a test note** in OpenClaw, watch it sync to Obsidian
3. **Edit in Obsidian**, verify it syncs back to OpenClaw
4. **Set up schedules** for periodic syncs (optional)
5. **Monitor audit logs** during first week

---

## Performance Tips

- **Faster sync:** Reduce `watcherDebounceMs` to 200ms
- **Larger vaults:** Keep `incrementalBatchSize` at 50+ to reduce API calls
- **Aggressive sync:** Add hourly schedule with `type: "interval"`

---

## Security Best Practices

- **Never commit config.json** to Git (add to `.gitignore`)
- **Protect your passphrase** (don't share in messages/logs)
- **Review audit logs** for suspicious activity
- **Use ACL scopes** to prevent accidental cross-agent writes

---

## Getting Help

- Check [CHANGELOG.md](CHANGELOG.md) for version history
- Review [README.md](README.md) for full documentation
- See [RELEASE_NOTES.md](RELEASE_NOTES.md) for feature overview
- File an issue: https://github.com/Liendocity/openclaw-plugin-obsidian-livesync/issues

---

**Happy syncing!** 🚀

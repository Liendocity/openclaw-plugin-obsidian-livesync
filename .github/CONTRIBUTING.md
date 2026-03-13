# Contributing Guide

Thank you for interest in contributing to the OpenClaw Obsidian LiveSync Plugin!

---

## Development Setup

```bash
git clone https://github.com/Liendocity/openclaw-plugin-obsidian-livesync.git
cd openclaw-plugin-obsidian-livesync
npm install
npm run build
npm test
```

---

## Architecture

```
src/
├── index.ts         # Main plugin class (P0+P1+P2 integration)
├── retry.ts         # Retry logic with exponential backoff
├── conflict.ts      # Conflict resolver & version manager
├── watcher.ts       # File change detection
├── merge.ts         # 3-way, Markdown, JSON merge strategies
├── incremental.ts   # Change tracking & batch sync
└── scheduler.ts     # Interval & cron-based scheduling
```

---

## Code Style

- **TypeScript** strict mode
- **ES2020** target
- **ESM modules**
- **2-space indentation**
- **JSDoc comments** for public methods

---

## Testing

All tests must pass before submitting PR:

```bash
npm test                # Run all tests
npm run test:retry      # Run retry tests only
npm run test:conflict   # Run conflict tests only
npm run test:merge      # Run merge tests only
npm run test:scheduler  # Run scheduler tests only
```

Add tests for new features in `test/` directory.

---

## Commit Messages

Use clear, descriptive commits:

```
feat: Add feature X (P0/P1/P2)
fix: Fix bug Y
docs: Update README
refactor: Clean up module Z
test: Add tests for feature X
```

Example:
```
feat: Add incremental sync batching (P2)
- Implement ChangeTracker for file hash tracking
- Add IncrementalSyncManager for batch operations
- Tests: incremental.test.ts with 8 test cases
```

---

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make changes and add tests
4. Run tests: `npm test`
5. Commit with clear messages
6. Push to your fork
7. Submit PR with description

---

## Feature Roadmap (P3+)

- [ ] **Operational Transform** for real-time collaboration
- [ ] **Offline mode** with local queue
- [ ] **Selective sync** (sync only specific folders)
- [ ] **Bandwidth throttling** for slow connections
- [ ] **Web dashboard** for monitoring
- [ ] **Multi-vault support**
- [ ] **Sync metrics** and performance analytics

---

## Known Issues & Limitations

### Current (P2)
- Simple cron parser (subset of full cron syntax)
- Last-write-wins by default (no merge for all file types)
- No offline mode (requires CouchDB connectivity)
- File watcher only monitors specific scopes

### Future Improvements
- Operational Transform for better conflict resolution
- Offline mode with resumable queue
- Full cron expression support (with external library)
- Selective per-file watcher configuration

---

## Performance Considerations

- **File watcher debounce**: 500ms default (lower = more CPU)
- **Batch size**: 50 files per sync (higher = fewer API calls)
- **Retry backoff**: 100ms initial, max 10s (exponential)
- **Chunk size**: 50KB per chunk (balance between latency & memory)

For large vaults (1000+ files), use incremental sync with batch size 100+.

---

## Security Guidelines

- Never hardcode secrets (salt, passphrase, tokens)
- Use setup_uri for configuration
- Validate all inputs in public tools
- Log sensitive operations (without exposing secrets)
- Test ACL boundaries (scope isolation)

---

## Documentation

Update docs when adding features:

- **README.md** - User guide & examples
- **CHANGELOG.md** - Version history & breaking changes
- **RELEASE_NOTES.md** - Release summaries
- **INSTALL.md** - Installation steps
- **Code comments** - JSDoc for public APIs

---

## Questions?

- Open an issue: https://github.com/Liendocity/openclaw-plugin-obsidian-livesync/issues
- Discuss: https://github.com/Liendocity/openclaw-plugin-obsidian-livesync/discussions
- Email: [your-email]

---

Thank you for contributing! 🙏

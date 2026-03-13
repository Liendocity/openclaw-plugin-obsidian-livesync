/**
 * Conflict resolution and versioning strategies
 */
/**
 * Conflict resolver: decides what to do when both local and remote versions exist
 */
export class ConflictResolver {
    strategy;
    constructor(strategy = 'last-write-wins') {
        this.strategy = strategy;
    }
    /**
     * Detect if there's a conflict between local and remote
     */
    hasConflict(local, remote) {
        // Same hash = no conflict
        if (local.hash === remote.hash)
            return false;
        // Different content = conflict
        return local.mtime !== remote.mtime || local.hash !== remote.hash;
    }
    /**
     * Resolve a conflict based on strategy
     */
    resolve(local, remote) {
        if (!this.hasConflict(local, remote)) {
            return { winner: 'local', action: 'no conflict' };
        }
        switch (this.strategy) {
            case 'last-write-wins':
                // Latest mtime wins
                if (local.mtime > remote.mtime) {
                    return { winner: 'local', action: 'local is newer' };
                }
                else if (remote.mtime > local.mtime) {
                    return { winner: 'remote', action: 'remote is newer' };
                }
                else {
                    // Same mtime, use local as tiebreaker
                    return { winner: 'local', action: 'same mtime, local wins (tiebreaker)' };
                }
            case 'remote-wins':
                return { winner: 'remote', action: 'remote-wins strategy' };
            case 'local-wins':
                return { winner: 'local', action: 'local-wins strategy' };
            case 'keep-both':
                return { winner: 'both', action: 'keeping both versions' };
            default:
                return { winner: 'local', action: 'unknown strategy, defaulting to local' };
        }
    }
    /**
     * Create a versioned copy of the file
     * Stores the old version in the database and marks it as historical
     */
    createVersionedCopy(metadata, version) {
        return {
            ...metadata,
            _id: `${metadata._id}.v${version}`,
            version,
            versions: metadata.versions || []
        };
    }
    /**
     * Update conflict resolution strategy
     */
    setStrategy(strategy) {
        this.strategy = strategy;
    }
}
/**
 * Version manager: tracks file versions over time
 */
export class VersionManager {
    maxVersionsPerFile = 10;
    /**
     * Record a version of a file
     */
    recordVersion(metadata, source, conflict = false) {
        const version = {
            version: metadata.version,
            mtime: metadata.mtime,
            hash: metadata.hash,
            _id: `${metadata._id}.v${metadata.version}`,
            source,
            conflict
        };
        const versions = metadata.versions || [];
        versions.push(version);
        // Keep only recent versions
        if (versions.length > this.maxVersionsPerFile) {
            versions.splice(0, versions.length - this.maxVersionsPerFile);
        }
        return {
            ...metadata,
            versions
        };
    }
    /**
     * Get version history for a file
     */
    getVersionHistory(metadata) {
        return metadata.versions || [];
    }
    /**
     * Revert to a specific version
     */
    revertToVersion(metadata, versionNumber) {
        const versions = metadata.versions || [];
        const target = versions.find(v => v.version === versionNumber);
        if (!target)
            return null;
        return {
            ...metadata,
            version: versionNumber,
            mtime: target.mtime,
            hash: target.hash
        };
    }
}
//# sourceMappingURL=conflict.js.map
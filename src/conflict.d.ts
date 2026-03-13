/**
 * Conflict resolution and versioning strategies
 */
export interface FileMetadata {
    _id: string;
    path: string;
    mtime: number;
    hash: string;
    size: number;
    version: number;
    versions?: FileVersion[];
}
export interface FileVersion {
    version: number;
    mtime: number;
    hash: string;
    _id: string;
    source: 'local' | 'remote';
    conflict?: boolean;
}
/**
 * Strategy for resolving conflicts
 */
export type ConflictStrategy = 'last-write-wins' | 'remote-wins' | 'local-wins' | 'keep-both';
/**
 * Conflict resolver: decides what to do when both local and remote versions exist
 */
export declare class ConflictResolver {
    private strategy;
    constructor(strategy?: ConflictStrategy);
    /**
     * Detect if there's a conflict between local and remote
     */
    hasConflict(local: FileMetadata, remote: FileMetadata): boolean;
    /**
     * Resolve a conflict based on strategy
     */
    resolve(local: FileMetadata, remote: FileMetadata): {
        winner: 'local' | 'remote' | 'both';
        action: string;
    };
    /**
     * Create a versioned copy of the file
     * Stores the old version in the database and marks it as historical
     */
    createVersionedCopy(metadata: FileMetadata, version: number): FileMetadata;
    /**
     * Update conflict resolution strategy
     */
    setStrategy(strategy: ConflictStrategy): void;
}
/**
 * Version manager: tracks file versions over time
 */
export declare class VersionManager {
    private maxVersionsPerFile;
    /**
     * Record a version of a file
     */
    recordVersion(metadata: FileMetadata, source: 'local' | 'remote', conflict?: boolean): FileMetadata;
    /**
     * Get version history for a file
     */
    getVersionHistory(metadata: FileMetadata): FileVersion[];
    /**
     * Revert to a specific version
     */
    revertToVersion(metadata: FileMetadata, versionNumber: number): FileMetadata | null;
}
//# sourceMappingURL=conflict.d.ts.map
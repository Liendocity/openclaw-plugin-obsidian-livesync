/**
 * Intelligent merge strategies for conflict resolution
 * Applies when local and remote both have changes
 */
export type MergeStrategy = 'simple' | 'line-based' | 'operational-transform';
export interface FilePart {
    content: string;
    hash: string;
}
/**
 * Simple 3-way merge (local, base, remote)
 * Works best for text files
 */
export declare class ThreeWayMerger {
    /**
     * Perform a 3-way merge
     * @param base - Original/common version
     * @param local - Local version
     * @param remote - Remote version
     * @returns Merged content or null if unresolvable conflicts
     */
    static merge(base: string, local: string, remote: string): {
        merged: string;
        conflicts: boolean;
    };
    private static arraysEqual;
}
/**
 * JSON-aware merge for structured data
 */
export declare class JsonMerger {
    /**
     * Merge two JSON objects
     * Array fields: concatenate unique items
     * Object fields: recursive merge
     * Primitive fields: use remote (or configurable)
     */
    static merge(local: any, remote: any, options?: {
        preferRemote?: boolean;
    }): {
        merged: any;
        conflicts: string[];
    };
}
/**
 * Markdown-aware merge (preserves frontmatter, metadata, etc.)
 */
export declare class MarkdownMerger {
    /**
     * Merge two markdown files intelligently
     * - Preserves YAML frontmatter from both
     * - Merges content using 3-way merge
     * - Concatenates block-level changes with markers
     */
    static merge(local: string, remote: string, base: string): {
        merged: string;
        conflicts: boolean;
    };
    private static extractFrontmatter;
}
//# sourceMappingURL=merge.d.ts.map
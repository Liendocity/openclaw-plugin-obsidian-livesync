/**
 * Intelligent merge strategies for conflict resolution
 * Applies when local and remote both have changes
 */
/**
 * Simple 3-way merge (local, base, remote)
 * Works best for text files
 */
export class ThreeWayMerger {
    /**
     * Perform a 3-way merge
     * @param base - Original/common version
     * @param local - Local version
     * @param remote - Remote version
     * @returns Merged content or null if unresolvable conflicts
     */
    static merge(base, local, remote) {
        const baseLines = base.split('\n');
        const localLines = local.split('\n');
        const remoteLines = remote.split('\n');
        // Simple line-based merge using longest common subsequence concept
        const merged = [];
        let conflicts = false;
        const localChanged = !this.arraysEqual(baseLines, localLines);
        const remoteChanged = !this.arraysEqual(baseLines, remoteLines);
        if (!localChanged && !remoteChanged) {
            // No changes on either side
            return { merged: base, conflicts: false };
        }
        if (!localChanged) {
            // Only remote changed
            return { merged: remote, conflicts: false };
        }
        if (!remoteChanged) {
            // Only local changed
            return { merged: local, conflicts: false };
        }
        // Both changed: attempt line-by-line merge
        const maxLines = Math.max(localLines.length, remoteLines.length);
        for (let i = 0; i < maxLines; i++) {
            const localLine = localLines[i] || '';
            const remoteLine = remoteLines[i] || '';
            const baseLine = baseLines[i] || '';
            if (localLine === remoteLine) {
                // Both agree
                merged.push(localLine);
            }
            else if (localLine === baseLine) {
                // Local unchanged, use remote
                merged.push(remoteLine);
            }
            else if (remoteLine === baseLine) {
                // Remote unchanged, use local
                merged.push(localLine);
            }
            else {
                // Both changed differently: CONFLICT
                conflicts = true;
                merged.push(`<<<<<<< LOCAL\n${localLine}\n=======\n${remoteLine}\n>>>>>>> REMOTE`);
            }
        }
        return { merged: merged.join('\n'), conflicts };
    }
    static arraysEqual(a, b) {
        if (a.length !== b.length)
            return false;
        return a.every((val, idx) => val === b[idx]);
    }
}
/**
 * JSON-aware merge for structured data
 */
export class JsonMerger {
    /**
     * Merge two JSON objects
     * Array fields: concatenate unique items
     * Object fields: recursive merge
     * Primitive fields: use remote (or configurable)
     */
    static merge(local, remote, options = {}) {
        const conflicts = [];
        const merged = { ...local };
        for (const key in remote) {
            if (!(key in local)) {
                // New field in remote
                merged[key] = remote[key];
            }
            else {
                const localVal = local[key];
                const remoteVal = remote[key];
                if (Array.isArray(localVal) && Array.isArray(remoteVal)) {
                    // Merge arrays: keep unique items
                    const combined = [...localVal];
                    for (const item of remoteVal) {
                        if (!combined.includes(item)) {
                            combined.push(item);
                        }
                    }
                    merged[key] = combined;
                }
                else if (typeof localVal === 'object' && typeof remoteVal === 'object') {
                    // Recursive merge
                    const result = this.merge(localVal, remoteVal, options);
                    merged[key] = result.merged;
                    conflicts.push(...result.conflicts.map(c => `${key}.${c}`));
                }
                else if (localVal !== remoteVal) {
                    // Primitive conflict
                    conflicts.push(`${key}: local=${localVal}, remote=${remoteVal}`);
                    merged[key] = options.preferRemote ? remoteVal : localVal;
                }
            }
        }
        return { merged, conflicts };
    }
}
/**
 * Markdown-aware merge (preserves frontmatter, metadata, etc.)
 */
export class MarkdownMerger {
    /**
     * Merge two markdown files intelligently
     * - Preserves YAML frontmatter from both
     * - Merges content using 3-way merge
     * - Concatenates block-level changes with markers
     */
    static merge(local, remote, base) {
        const { frontmatter: localFm, content: localContent } = this.extractFrontmatter(local);
        const { frontmatter: remoteFm, content: remoteContent } = this.extractFrontmatter(remote);
        const { frontmatter: baseFm, content: baseContent } = this.extractFrontmatter(base);
        // Merge frontmatter
        const mergedFm = { ...baseFm, ...localFm };
        for (const key in remoteFm) {
            if (!(key in localFm) || localFm[key] === baseFm[key]) {
                mergedFm[key] = remoteFm[key];
            }
        }
        // Merge content
        const { merged: mergedContent, conflicts } = ThreeWayMerger.merge(baseContent, localContent, remoteContent);
        const frontmatterStr = Object.keys(mergedFm).length
            ? `---\n${Object.entries(mergedFm)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}\n---\n\n`
            : '';
        return {
            merged: frontmatterStr + mergedContent,
            conflicts
        };
    }
    static extractFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!match) {
            return { frontmatter: {}, content };
        }
        const fmLines = match[1].split('\n');
        const frontmatter = {};
        for (const line of fmLines) {
            const [key, ...rest] = line.split(':');
            if (key && rest.length) {
                frontmatter[key.trim()] = rest.join(':').trim();
            }
        }
        return { frontmatter, content: match[2] };
    }
}
//# sourceMappingURL=merge.js.map
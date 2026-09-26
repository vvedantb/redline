import { normalizePath } from './source';
import type { DiffFile, DiffHunk, SourceLocation } from './types';

export interface TaggedNode<T = unknown> extends SourceLocation {
  /** Caller-owned handle (a DOM element in the browser, anything in tests). */
  ref: T;
}

export interface ChangedRegion<T = unknown> {
  node: TaggedNode<T>;
  file: DiffFile;
  hunk: DiffHunk;
  /** The changed line that matched this node. */
  line: number;
}

function span(n: SourceLocation): number {
  return n.endLine - n.startLine;
}

/**
 * All nodes at the innermost source location satisfying `test`.
 * Smallest line span wins; on ties the later start is the deeper element.
 * Several nodes can share one location (lists, reused markup).
 */
function innermost<T>(nodes: TaggedNode<T>[], test: (n: TaggedNode<T>) => boolean): TaggedNode<T>[] {
  const hits = nodes.filter(test);
  if (hits.length === 0) return [];
  const minSpan = Math.min(...hits.map(span));
  const narrow = hits.filter((n) => span(n) === minSpan);
  const start = Math.max(...narrow.map((n) => n.startLine));
  return narrow.filter((n) => n.startLine === start);
}

/**
 * Map diff hunks onto tagged nodes.
 *
 * - Each added/modified line maps to the innermost node whose source range contains it.
 * - A pure deletion between lines n and n+1 maps to the innermost node containing both.
 * - Lines outside any tagged node (imports, helpers) are ignored.
 * - When an element is entirely new, its tagged children are folded into it.
 * - Nodes in files without changes are never returned.
 */
export function matchChangedRegions<T>(nodes: TaggedNode<T>[], files: DiffFile[]): ChangedRegion<T>[] {
  const byFile = new Map<string, TaggedNode<T>[]>();
  for (const n of nodes) {
    const key = normalizePath(n.file);
    const list = byFile.get(key);
    if (list) list.push(n);
    else byFile.set(key, [n]);
  }

  const seen = new Set<TaggedNode<T>>();
  const regions: ChangedRegion<T>[] = [];
  const add = (hits: TaggedNode<T>[], file: DiffFile, hunk: DiffHunk, line: number) => {
    for (const node of hits) {
      if (seen.has(node)) continue;
      seen.add(node);
      regions.push({ node, file, hunk, line });
    }
  };

  for (const file of files) {
    if (file.status === 'deleted') continue;
    const candidates = byFile.get(normalizePath(file.path));
    if (!candidates) continue;
    const added = new Set(file.hunks.flatMap((h) => h.changedLines));
    const fileStart = regions.length;
    for (const hunk of file.hunks) {
      for (const line of hunk.changedLines) {
        add(innermost(candidates, (n) => n.startLine <= line && n.endLine >= line), file, hunk, line);
      }
      for (const after of hunk.deletions) {
        add(
          innermost(candidates, (n) => n.startLine <= after && n.endLine >= after + 1),
          file,
          hunk,
          after,
        );
      }
    }
    // An element whose every line is new is outlined once, not once per child.
    const fileRegions = regions.splice(fileStart);
    const isNew = (n: SourceLocation) => {
      for (let l = n.startLine; l <= n.endLine; l++) if (!added.has(l)) return false;
      return true;
    };
    const newBlocks = fileRegions.map((r) => r.node).filter(isNew);
    regions.push(
      ...fileRegions.filter(
        (r) =>
          !newBlocks.some(
            (b) => b !== r.node && span(b) > span(r.node) && b.startLine <= r.node.startLine && b.endLine >= r.node.endLine,
          ),
      ),
    );
  }
  return regions;
}

/** Find the hunk that covers a given file and line, if any. */
export function findHunk(files: DiffFile[], file: string, line: number): DiffHunk | null {
  const f = files.find((x) => normalizePath(x.path) === normalizePath(file));
  if (!f) return null;
  return f.hunks.find((h) => line >= h.startLine && line <= h.endLine) ?? null;
}

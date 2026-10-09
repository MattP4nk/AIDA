/**
 * The filesystem SKELETON: the root and the standard top-level directories
 * every server is provisioned with.
 *
 * Provisioning flags some of them `isProtected` (the root, `/bin`, `/etc` —
 * fileService.initializeFileSystem) so they cannot be deleted or renamed. That
 * protection is about the NODE. Protection on any other directory — `protect`,
 * a vault, collar.shield, story content — shields what is INSIDE it
 * (inherited, decision Q4) and, on a player's home, gates opening it
 * (`breach`, decision Q9).
 *
 * Without this distinction, inheritance made every file under a protected root
 * protected: 492 world servers became unwritable (2026-10-09, found while
 * building Q9 — the batch-1 inheritance change caused it).
 *
 * The provisioners each create a SUBSET of these names (authService,
 * fileService.initializeFileSystem, serverContentService); keep this the union.
 */
export const SKELETON_DIRS: ReadonlySet<string> = new Set(["home", "bin", "etc", "var", "tmp", "logs", "data"]);

/** Is this node part of the skeleton? `parentIsRoot`: its parent has no parent. */
export function isSkeletonNode(node: { name: string; parentId: string | null }, parentIsRoot: boolean): boolean {
  return node.parentId === null || (parentIsRoot && SKELETON_DIRS.has(node.name));
}

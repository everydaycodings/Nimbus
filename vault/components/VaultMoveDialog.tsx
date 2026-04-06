"use client";

import { useEffect, useState, useTransition } from "react";
import { X, FolderSimple, House, CaretRight } from "@phosphor-icons/react";
import {
    getVaultFolders,
    moveVaultFile,
    moveVaultFolder,
} from "@/vault/actions/vault.folders.actions";
import { useMoveVaultItemMutation } from "@/vault/hooks/queries/useVaultMutations";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TEAL = "#2da07a";

interface FolderNode {
    id: string;
    name: string;
    parent_folder_id: string | null;
    children?: FolderNode[];
}

interface Props {
    vaultId: string; // ✅ important
    vaultName?: string; // optional (for UI)
    items: {
        id: string;
        name: string;
        type: "file" | "folder";
    }[];
    onClose: () => void;
    onSuccess?: () => void;
}

// ── Build tree ─────────────────────────────────────
function buildTree(flat: FolderNode[]): FolderNode[] {
    const map = new Map<string, FolderNode>();
    const roots: FolderNode[] = [];

    flat.forEach((f) => map.set(f.id, { ...f, children: [] }));

    flat.forEach((f) => {
        const node = map.get(f.id)!;
        if (f.parent_folder_id && map.has(f.parent_folder_id)) {
            map.get(f.parent_folder_id)!.children!.push(node);
        } else {
            roots.push(node);
        }
    });

    return roots;
}

// ── Tree Node ─────────────────────────────────────
function TreeNode({
    node,
    depth,
    selectedId,
    onSelect,
}: {
    node: FolderNode;
    depth: number;
    selectedId: string | null;
    onSelect: (id: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const hasChildren = node.children && node.children.length > 0;

    return (
        <div>
            <div
                onClick={() => onSelect(node.id)}
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-sm",
                    selectedId === node.id
                        ? "text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                style={{
                    paddingLeft: `${12 + depth * 16}px`,
                    backgroundColor: selectedId === node.id ? "rgba(45,160,122,0.12)" : undefined,
                }}
            >
                {hasChildren ? (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpen(!open);
                        }}
                    >
                        <CaretRight
                            size={12}
                            className={cn("transition-transform", open && "rotate-90")}
                        />
                    </button>
                ) : (
                    <span className="w-3" />
                )}

                <FolderSimple
                    size={16}
                    weight="fill"
                    style={{ color: selectedId === node.id ? "#2da07a" : undefined }}
                    className={selectedId !== node.id ? "text-muted-foreground" : ""}
                />

                <span className="truncate">{node.name}</span>
            </div>

            {open &&
                node.children?.map((child) => (
                    <TreeNode
                        key={child.id}
                        node={child}
                        depth={depth + 1}
                        selectedId={selectedId}
                        onSelect={onSelect}
                    />
                ))}
        </div>
    );
}

// ── MAIN DIALOG ─────────────────────────────────────
export default function VaultMoveDialog({
    vaultId,
    vaultName,
    items,
    onClose,
    onSuccess,
}: Props) {
    const [tree, setTree] = useState<FolderNode[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // 🔥 Load ONLY vault folders
    useEffect(() => {
        const load = async () => {
            try {
                const folders = await getVaultFolders(vaultId, null);

                // ensure parent_folder_id exists
                const normalized = folders.map((f: any) => ({
                    ...f,
                    parent_folder_id: f.parent_folder_id ?? null,
                }));

                setTree(buildTree(normalized));
            } catch {
                toast.error("Failed to load folders");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [vaultId]);

    const { mutateAsync: moveItems, isPending } = useMoveVaultItemMutation();

    // ── Move handler ─────────────────────────────────
    const handleMove = async () => {
        try {
            await moveItems({ items, targetFolderId: selectedId });
            toast.success("Moved successfully");
            onSuccess?.();
            onClose();
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to move items"
            );
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl flex flex-col max-h-[500px]">

                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <h2 className="text-sm font-semibold truncate max-w-[80%]">
                        Move{" "}
                        {items.length > 1
                            ? `${items.length} items`
                            : `"${items[0]?.name}"`}
                    </h2>

                    <button
                        onClick={onClose}
                        className="p-1 rounded-lg hover:bg-accent"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Tree */}
                <div className="flex-1 overflow-y-auto p-2">
                    {loading ? (
                        <p className="text-sm text-muted-foreground px-3 py-2">
                            Loading folders...
                        </p>
                    ) : (
                        <>
                            {/* ✅ Vault root (fixed) */}
                            <div
                                onClick={() => setSelectedId(null)}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-sm",
                                    selectedId === null
                                        ? "font-medium text-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                )}
                                style={{
                                    backgroundColor: selectedId === null ? "rgba(45,160,122,0.12)" : undefined,
                                }}
                            >
                                <House
                                    size={16}
                                    weight="duotone"
                                    style={{ color: selectedId === null ? "#2da07a" : undefined }}
                                />
                                {vaultName ? `${vaultName} (root)` : "Vault root"}
                            </div>

                            {tree.map((node) => (
                                <TreeNode
                                    key={node.id}
                                    node={node}
                                    depth={0}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                />
                            ))}
                            {tree.length === 0 && (
                                <p className="text-xs text-muted-foreground px-3 py-2">No other folders available</p>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 p-4 border-t border-border">
                    <button
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-xl text-sm hover:bg-accent"
                    >
                        Cancel
                    </button>

                    <button
                        onClick={handleMove}
                        disabled={isPending}
                        className="px-4 py-1.5 rounded-xl text-sm text-white"
                        style={{ backgroundColor: TEAL }}
                    >
                        {isPending ? "Moving..." : "Move here"}
                    </button>
                </div>
            </div>
        </div>
    );
}
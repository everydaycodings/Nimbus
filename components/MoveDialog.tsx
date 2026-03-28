"use client";

import { useState, useEffect, useTransition } from "react";
import { FolderSimple, X, House, CaretRight } from "@phosphor-icons/react";
import { getFolderTree, moveFile, moveFolder } from "@/actions/folders";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface FolderNode {
  id: string;
  name: string;
  parent_folder_id: string | null;
  children?: FolderNode[];
}

interface Props {
  itemId: string;
  itemName: string;
  itemType: "file" | "folder";
  onSuccess: (targetFolderId: string | null) => void; // ✅ updated
  onClose: () => void;
  copyMode?: boolean; // ✅ added
}

// Build tree from flat list
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

function FolderTreeNode({
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
  const [expanded, setExpanded] = useState(false);
  const hasChildren = (node.children?.length ?? 0) > 0;

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-sm",
          selectedId === node.id
            ? "text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
        style={{
          paddingLeft: `${12 + depth * 16}px`,
          backgroundColor:
            selectedId === node.id ? "rgba(45,160,122,0.12)" : undefined,
        }}
        onClick={() => onSelect(node.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="flex-shrink-0"
          >
            <CaretRight
              size={12}
              className={cn("transition-transform", expanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        <FolderSimple
          size={16}
          weight="fill"
          style={{ color: selectedId === node.id ? "#2da07a" : undefined }}
          className={selectedId !== node.id ? "text-muted-foreground" : ""}
        />
        <span className="truncate">{node.name}</span>
      </div>

      {expanded && hasChildren && (
        <div>
          {node.children!.map((child) => (
            <FolderTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function MoveDialog({
  itemId,
  itemName,
  itemType,
  onSuccess,
  onClose,
  copyMode, // ✅ added
}: Props) {
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getFolderTree(itemType === "folder" ? itemId : undefined)
      .then((folders) => setTree(buildTree(folders)))
      .finally(() => setLoading(false));
  }, [itemId, itemType]);

  const handleMove = () => {
    startTransition(async () => {
      try {
        if (!copyMode) {
          // ✅ only move if NOT copying
          if (itemType === "file") {
            await moveFile(itemId, selectedId);
          } else {
            await moveFolder(itemId, selectedId);
          }
        }

        onSuccess(selectedId); // ✅ pass selected folder back
        onClose();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to move item"
        );
      }
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl flex flex-col max-h-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-semibold truncate max-w-[80%]">
            {copyMode ? "Copy " : "Move "}
            <span className="text-muted-foreground font-normal">
              "{itemName}"
            </span>
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
              {/* Root */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all text-sm",
                  selectedId === null
                    ? "font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
                style={{
                  backgroundColor:
                    selectedId === null
                      ? "rgba(45,160,122,0.12)"
                      : undefined,
                }}
                onClick={() => setSelectedId(null)}
              >
                <House
                  size={16}
                  weight="duotone"
                  style={{
                    color: selectedId === null ? "#2da07a" : undefined,
                  }}
                />
                <span>My Files (root)</span>
              </div>

              {tree.map((node) => (
                <FolderTreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}

              {tree.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">
                  No other folders available
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleMove}
            disabled={isPending}
            className={cn(
              "px-4 py-1.5 rounded-xl text-sm font-medium text-white transition-all",
              isPending ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
            )}
            style={{ backgroundColor: "#2da07a" }}
          >
            {isPending ? "..." : copyMode ? "Copy here" : "Move here"}
          </button>
        </div>
      </div>
    </div>
  );
}
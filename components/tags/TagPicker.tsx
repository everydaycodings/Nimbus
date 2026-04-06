// components/tags/TagPicker.tsx
"use client";

import { useState, useEffect } from "react";
import { Plus, Tag as TagIcon, Check, PlusCircle, PencilSimple } from "@phosphor-icons/react";
import { Tag } from "@/types/tags";
import { useTagsQuery } from "@/hooks/queries/useTagsQuery";
import { assignTag, unassignTag } from "@/actions/tags";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TagManager } from "./TagManager";
import { cn } from "@/lib/utils";
import { getQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

interface TagPickerProps {
  itemId: string;
  itemType: "file" | "folder";
  currentTagIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function TagPicker({
  itemId,
  itemType,
  currentTagIds,
  onClose,
  onSuccess,
}: TagPickerProps) {
  const { data: availableTags = [], isLoading } = useTagsQuery();
  const [showManager, setShowManager] = useState(false);
  
  // Track optimistic state
  const [optimisticTagIds, setOptimisticTagIds] = useState<string[]>(currentTagIds);
  const [pendingTagIds, setPendingTagIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Sync with external state if no local mutations are pending
    if (Object.keys(pendingTagIds).length === 0) {
      setOptimisticTagIds(currentTagIds);
    }
  }, [currentTagIds, pendingTagIds]);

  const toggleTag = async (tag: Tag) => {
    if (pendingTagIds[tag.id]) return;

    const isAssigned = optimisticTagIds.includes(tag.id);
    
    // Optimistic update
    setOptimisticTagIds(prev => 
      isAssigned ? prev.filter(id => id !== tag.id) : [...prev, tag.id]
    );
    
    setPendingTagIds(prev => ({ ...prev, [tag.id]: true }));

    try {
      if (isAssigned) {
        await unassignTag(itemId, itemType, tag.id);
      } else {
        await assignTag(itemId, itemType, tag.id);
      }
      getQueryClient().invalidateQueries({ queryKey: queryKeys.all });
      onSuccess?.();
    } catch (err) {
      console.error(err);
      // Revert on error
      setOptimisticTagIds(prev => 
        isAssigned ? [...prev, tag.id] : prev.filter(id => id !== tag.id)
      );
    } finally {
      setPendingTagIds(prev => {
        const next = { ...prev };
        delete next[tag.id];
        return next;
      });
    }
  };

  if (showManager) {
    return <TagManager onClose={() => setShowManager(false)} />;
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[320px] p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b border-border">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <TagIcon size={18} weight="fill" className="text-primary" />
            Edit Tags
          </DialogTitle>
        </DialogHeader>

        <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="text-center py-6 text-xs text-muted-foreground animate-pulse">
              Loading tags...
            </div>
          ) : availableTags.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <TagIcon size={32} weight="thin" className="text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">No tags found.</p>
              <button 
                onClick={() => setShowManager(true)}
                className="text-xs text-primary font-semibold mt-2 hover:underline"
              >
                Create your first tag
              </button>
            </div>
          ) : (
            availableTags.map((tag) => {
              const isSelected = optimisticTagIds.includes(tag.id);
              const isTagPending = pendingTagIds[tag.id];
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag)}
                  disabled={isTagPending}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-lg transition-all text-left",
                    "hover:bg-accent/50",
                    isTagPending && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div 
                    className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0",
                      isSelected 
                        ? "bg-primary border-primary text-primary-foreground" 
                        : "border-muted-foreground/30 text-transparent bg-background"
                    )}
                  >
                    <Check size={12} weight="bold" />
                  </div>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                    <span className="text-sm font-medium truncate">{tag.name}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="p-2 border-t border-border bg-muted/20">
          <button
            onClick={() => setShowManager(true)}
            className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted text-xs font-semibold text-muted-foreground hover:text-foreground transition-all"
          >
            <PencilSimple size={14} />
            Manage Tags
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// components/tags/TagPicker.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { Plus, Tag as TagIcon, Check, PlusCircle, PencilSimple } from "@phosphor-icons/react";
import { Tag } from "@/types/tags";
import { getTags, assignTag, unassignTag } from "@/actions/tags";
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
  const [availableTags, setAvailableTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showManager, setShowManager] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetchTags();
  }, []);

  const fetchTags = async () => {
    setIsLoading(true);
    try {
      const data = await getTags();
      setAvailableTags(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleTag = (tag: Tag) => {
    const isAssigned = currentTagIds.includes(tag.id);
    
    startTransition(async () => {
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
      }
    });
  };

  if (showManager) {
    return <TagManager onClose={() => setShowManager(false)} onTagsChange={fetchTags} />;
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
              const isSelected = currentTagIds.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag)}
                  disabled={isPending}
                  className={cn(
                    "w-full flex items-center justify-between p-2.5 rounded-lg transition-all text-left",
                    "hover:bg-accent/50",
                    isPending && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="text-sm font-medium">{tag.name}</span>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
                      <Check size={12} weight="bold" className="text-primary" />
                    </div>
                  )}
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

// components/tags/TagManager.tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { Plus, Pencil, Trash, X, Check } from "@phosphor-icons/react";
import { Tag } from "@/types/tags";
import { getTags, createTag, updateTag, deleteTag } from "@/actions/tags";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const COLORS = [
  "#ef4444", // Red
  "#f97316", // Orange
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#d946ef", // Fuchsia
  "#f43f5e", // Rose
  "#64748b", // Slate
];

interface TagManagerProps {
  onClose: () => void;
  onTagsChange?: () => void;
}

export function TagManager({ onClose, onTagsChange }: TagManagerProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    fetchTags();
  }, []);

  const fetchTags = async () => {
    setIsLoading(true);
    try {
      const data = await getTags();
      setTags(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateOrUpdate = () => {
    if (!newName.trim()) return;

    startTransition(async () => {
      try {
        if (editingTag) {
          await updateTag(editingTag.id, newName, newColor);
        } else {
          await createTag(newName, newColor);
        }
        setNewName("");
        setNewColor(COLORS[0]);
        setEditingTag(null);
        fetchTags();
        onTagsChange?.();
      } catch (err) {
        console.error(err);
      }
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm("Are you sure you want to delete this tag? This will remove it from all items.")) return;
    
    startTransition(async () => {
      try {
        await deleteTag(id);
        fetchTags();
        onTagsChange?.();
      } catch (err) {
        console.error(err);
      }
    });
  };

  const startEdit = (tag: Tag) => {
    setEditingTag(tag);
    setNewName(tag.name);
    setNewColor(tag.color);
  };

  const cancelEdit = () => {
    setEditingTag(null);
    setNewName("");
    setNewColor(COLORS[0]);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Create / Edit Form */}
          <div className="space-y-4 p-4 rounded-xl bg-muted/30 border border-border">
            <div className="flex gap-3">
              <Input
                placeholder="Tag name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="flex-1"
                disabled={isPending}
              />
              <Button 
                onClick={handleCreateOrUpdate} 
                disabled={isPending || !newName.trim()}
                variant="default"
                size="icon"
                className="shrink-0"
              >
                {editingTag ? <Check size={18} /> : <Plus size={18} />}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={cn(
                    "w-6 h-6 rounded-full border-2 transition-transform hover:scale-110",
                    newColor === c ? "border-foreground scale-110" : "border-transparent"
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>

            {editingTag && (
              <Button variant="ghost" size="sm" onClick={cancelEdit} className="w-full text-xs h-8">
                Cancel Editing
              </Button>
            )}
          </div>

          {/* Tags List */}
          <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 custom-scrollbar">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm italic">Loading tags...</div>
            ) : tags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No tags created yet.</div>
            ) : (
              tags.map((tag) => (
                <div
                  key={tag.id}
                  className="group flex items-center justify-between p-2 rounded-lg hover:bg-accent/50 border border-transparent hover:border-border transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className="text-sm font-medium">{tag.name}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(tag)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(tag.id)}
                      className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-red-400 transition-colors"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

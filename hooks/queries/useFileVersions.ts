// hooks/queries/useFileVersions.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "sonner";

export function useFileVersions(fileId: string) {
  const queryClient = useQueryClient();

  // ── Query: Fetch versions ──
  const { data, isLoading, error } = useQuery({
    queryKey: ["file-versions", fileId],
    queryFn: async () => {
      const res = await fetch(`/api/files/${fileId}/versions`);
      if (!res.ok) throw new Error("Failed to fetch versions");
      return res.json() as Promise<{ versions: any[] }>;
    },
    enabled: !!fileId,
  });

  // ── Mutation: Restore version ──
  const restoreMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await fetch(`/api/files/${fileId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) throw new Error("Failed to restore version");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Version restored successfully");
      queryClient.invalidateQueries({ queryKey: queryKeys.all });
      queryClient.invalidateQueries({ queryKey: ["file-versions", fileId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to restore version");
    },
  });

  // ── Mutation: Delete version ──
  const deleteMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await fetch(`/api/files/${fileId}/versions/${versionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete version");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Version deleted");
      queryClient.invalidateQueries({ queryKey: ["file-versions", fileId] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to delete version");
    },
  });

  return {
    versions: data?.versions ?? [],
    isLoading,
    error,
    restoreVersion: restoreMutation.mutate,
    isRestoring: restoreMutation.isPending,
    deleteVersion: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
  };
}

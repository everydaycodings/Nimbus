// hooks/mutations/useSharingMutations.ts
import { useMutation } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";
import {
  revokeShareLink,
  revokeUserPermission,
  copySharedFileToDrive,
  copySharedFolderToDrive,
} from "@/actions/sharing.dashboard";

export function useRevokeShareLinkMutation() {
  return useMutation({
    mutationFn: (id: string) => revokeShareLink(id),
    onSuccess: () => {
      getQueryClient().invalidateQueries({ queryKey: queryKeys.sharing() });
    },
  });
}

export function useRevokeUserPermissionMutation() {
  return useMutation({
    mutationFn: (id: string) => revokeUserPermission(id),
    onSuccess: () => {
      getQueryClient().invalidateQueries({ queryKey: queryKeys.sharing() });
    },
  });
}

export function useCopySharedResourceMutation() {
  return useMutation({
    mutationFn: async ({
      resourceId,
      resourceType,
      targetFolderId,
    }: {
      resourceId: string;
      resourceType: "file" | "folder";
      targetFolderId: string | null;
    }) => {
      if (resourceType === "file") {
        return copySharedFileToDrive(resourceId, targetFolderId);
      } else {
        return copySharedFolderToDrive(resourceId, targetFolderId);
      }
    },
    onSuccess: () => {
      // Refresh files because we copied something to our drive
      getQueryClient().invalidateQueries({ queryKey: queryKeys.all });
    },
  });
}

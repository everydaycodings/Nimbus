// hooks/queries/useSharingQuery.ts
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getMySharedItems, getSharedWithMe } from "@/actions/sharing.dashboard";

export function useSharingQuery() {
  return useQuery({
    queryKey: queryKeys.sharing(),
    queryFn: async () => {
      const [mine, withMe] = await Promise.all([
        getMySharedItems(),
        getSharedWithMe(),
      ]);
      return {
        mine,
        withMe,
      };
    },
  });
}

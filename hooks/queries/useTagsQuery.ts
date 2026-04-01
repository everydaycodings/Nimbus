import { useQuery } from "@tanstack/react-query";
import { getTags } from "@/actions/tags";
import { Tag } from "@/types/tags";

export function useTagsQuery() {
  return useQuery<Tag[]>({
    queryKey: ["tags"],
    queryFn: async () => {
      return await getTags();
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

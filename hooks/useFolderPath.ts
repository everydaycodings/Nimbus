"use client";

// Shared folder-location state driven by the URL (`path` + `names` query
// params) so that browser back/forward, refresh, and deep-links all work the
// same way across Drive, Vault, and Offline Vault.
//
// URL schema (same as Drive already used):
//   ?path=<id1>,<id2>,...&names=<enc1>,<enc2>,...
// Folder names are encodeURIComponent'd; real commas become %2C so splitting on
// "," is safe. IDs are UUIDs (no commas).

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export interface Crumb {
  id: string;
  name: string;
}

export function useFolderPath() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const breadcrumbs = useMemo<Crumb[]>(() => {
    const pathParam = searchParams.get("path");
    const namesParam = searchParams.get("names");
    if (!pathParam || !namesParam) return [];

    const ids = pathParam.split(",").filter(Boolean);
    const names = namesParam.split(",").map((n) => {
      try {
        return decodeURIComponent(n);
      } catch {
        return n;
      }
    });
    return ids.map((id, i) => ({ id, name: names[i] ?? "" }));
  }, [searchParams]);

  const currentFolderId =
    breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].id : null;

  // Push a new breadcrumb trail while preserving all other query params
  // (filters, sort, type, etc.) — fixes the prior bug where navigating a folder
  // dropped active filters.
  const pushPath = useCallback(
    (crumbs: Crumb[]) => {
      const params = new URLSearchParams(searchParams.toString());

      if (crumbs.length === 0) {
        params.delete("path");
        params.delete("names");
      } else {
        params.set("path", crumbs.map((c) => c.id).join(","));
        params.set(
          "names",
          crumbs.map((c) => encodeURIComponent(c.name)).join(",")
        );
      }

      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams]
  );

  const openFolder = useCallback(
    (id: string, name: string) => pushPath([...breadcrumbs, { id, name }]),
    [breadcrumbs, pushPath]
  );

  const navigateToBreadcrumb = useCallback(
    (index: number) => pushPath(breadcrumbs.slice(0, index + 1)),
    [breadcrumbs, pushPath]
  );

  const navigateToRoot = useCallback(() => pushPath([]), [pushPath]);

  return {
    breadcrumbs,
    currentFolderId,
    openFolder,
    navigateToBreadcrumb,
    navigateToRoot,
    isPending,
  };
}

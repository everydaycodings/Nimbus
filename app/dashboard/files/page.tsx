import { getFiles } from "@/actions/files";
import { FileListClient } from "@/components/FileListClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Files",
  description: "View and manage your files on Nimbus.",
};

export default async function FilesPage(props: {
  searchParams: Promise<any>;
}) {
  const searchParams = await props.searchParams;
  const pathParam = searchParams?.path;
  const folderParam = searchParams?.folder;
  const query = searchParams?.query;

  const activeFolderId = (() => {
    if (pathParam) {
      const ids = String(pathParam).split(",");
      return ids[ids.length - 1];
    }
    if (folderParam) return String(folderParam);
    if (query) return null;
    return null;
  })();

  const queryOptions = {
    page: Number(searchParams?.page || 1),
    query: searchParams?.query ? String(searchParams.query) : undefined,
    type: searchParams?.type ? String(searchParams.type) : undefined,
    sortBy: searchParams?.sortBy ? String(searchParams.sortBy) : undefined,
    sortOrder: searchParams?.sortOrder ? String(searchParams.sortOrder) : undefined,
    minSize: searchParams?.minSize ? Number(searchParams.minSize) : undefined,
    maxSize: searchParams?.maxSize ? Number(searchParams.maxSize) : undefined,
  };

  // Pre-fetch the data on the server
  let initialData = null;
  try {
    initialData = await getFiles(activeFolderId, queryOptions);
  } catch (error) {
    console.error("Failed to fetch initial files data:", error);
  }

  return <FileListClient initialData={initialData} />;
}
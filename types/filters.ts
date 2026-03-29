// types/filters.ts

export type SortBy = "name" | "size" | "created_at";
export type SortOrder = "asc" | "desc";

export type FileType = "all" | "image" | "video" | "audio" | "document" | "other";

export interface FileFilters {
  type: FileType;
  sortBy: SortBy;
  sortOrder: SortOrder;
  minSize?: number;
  maxSize?: number;
}

export const FILE_TYPE_MAP: Record<FileType, string[]> = {
  all: [],
  image: ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"],
  video: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"],
  audio: ["audio/mpeg", "audio/wav", "audio/ogg", "audio/aac"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
  ],
  other: [],
};

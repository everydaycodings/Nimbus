// types/tags.ts

export interface Tag {
  id: string;
  name: string;
  color: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface ItemTag {
  tag: Tag;
}

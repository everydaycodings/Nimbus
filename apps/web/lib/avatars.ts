// Preset avatars in public/avatars (flat illustrations made with Higgsfield).
const file = (n: number) => `/avatars/${String(n).padStart(2, "0")}.webp`

const PEOPLE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 19, 20]
// Robot and animals. New accounts get one of these, since we don't know what
// someone looks like.
const CHARACTERS = [11, 12, 21, 22, 23, 24, 25, 26, 27, 28].map(file)

export const PRESETS = [...PEOPLE.map(file), ...CHARACTERS]

export const randomPreset = () =>
  CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]

// Uploaded avatars are served from /api/avatar/<key>, where key is `<userId>-<rand>`.
export const AVATAR_URL = "/api/avatar/"

/* eslint-disable @next/next/no-img-element -- provider avatars come from arbitrary hosts */
export function UserAvatar({
  name,
  image,
  size = 32,
}: {
  name: string
  image?: string | null
  size?: number
}) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
  return image ? (
    <img
      src={image}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
    >
      {initials}
    </span>
  )
}

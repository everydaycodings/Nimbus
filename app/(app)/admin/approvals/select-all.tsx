"use client"

// Checks or clears every "id" box in its form.
export function SelectAll({ count }: { count: number }) {
  return (
    <input
      type="checkbox"
      aria-label={`Select all ${count}`}
      className="size-4 shrink-0 accent-primary"
      onChange={(e) => {
        for (const box of e.currentTarget.form?.querySelectorAll<HTMLInputElement>(
          'input[name="id"]'
        ) ?? [])
          box.checked = e.currentTarget.checked
      }}
    />
  )
}

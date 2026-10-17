import { FolderOpenIcon } from "@phosphor-icons/react/dist/ssr"

import { getSession } from "@/lib/session"

export default async function HomePage() {
  const session = await getSession()
  const firstName = session?.user.name.split(" ")[0]

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My files</h1>
        <p className="text-sm text-muted-foreground">Welcome, {firstName}.</p>
      </div>
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-input px-6 py-16 text-center">
        <span className="mb-2 grid size-10 place-items-center rounded-lg bg-muted">
          <FolderOpenIcon className="size-5 text-file-folder" />
        </span>
        <h2 className="font-medium">No files yet</h2>
        <p className="max-w-sm text-sm text-balance text-muted-foreground">
          Your files and folders will show up here. Uploading arrives in the
          next update of Nimbus.
        </p>
      </div>
    </div>
  )
}

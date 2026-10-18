"use client"

import { Dialog } from "@base-ui/react/dialog"
import { CloudIcon, ListIcon, SidebarSimpleIcon } from "@phosphor-icons/react"
import { usePathname } from "next/navigation"
import { createContext, useContext, useEffect, useState } from "react"

import { SIDEBAR_COOKIE } from "@/components/nav-styles"
import { Button } from "@/components/ui/button"

// Desktop rail state. Inside the phone drawer it is always expanded.
const SidebarContext = createContext({ collapsed: false })
export const useSidebar = () => useContext(SidebarContext)

// App shell: a sidebar that collapses to an icon rail from md up, and a drawer
// below md. `sidebar` is rendered in both places; it styles itself off the
// `group/sidebar` data-collapsed attribute and useSidebar().
export function SidebarShell({
  sidebar: files,
  adminSidebar,
  children,
  defaultCollapsed,
  actions,
}: {
  sidebar: React.ReactNode
  // Shown instead of `sidebar` anywhere under /admin.
  adminSidebar?: React.ReactNode
  children: React.ReactNode
  defaultCollapsed: boolean
  // Right end of the header: search and the bell.
  actions?: React.ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [open, setOpen] = useState(false)

  // Close the drawer when a link inside it navigates.
  const path = usePathname()
  const [lastPath, setLastPath] = useState(path)
  if (path !== lastPath) {
    setLastPath(path)
    setOpen(false)
  }
  const sidebar =
    adminSidebar && path.startsWith("/admin") ? adminSidebar : files

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 1 : 0}; path=/; max-age=31536000; samesite=lax`
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        document.getElementById("sidebar-toggle")?.click()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="flex min-h-svh bg-sidebar">
      <SidebarContext.Provider value={{ collapsed }}>
        <aside
          data-collapsed={collapsed}
          aria-label="Sidebar"
          className="group/sidebar sticky top-0 hidden h-svh w-64 shrink-0 overflow-x-hidden text-sidebar-foreground transition-[width] duration-200 ease-out data-[collapsed=true]:w-12 motion-reduce:transition-none md:block"
        >
          {sidebar}
        </aside>
      </SidebarContext.Provider>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 md:hidden" />
          <Dialog.Popup className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r bg-sidebar text-sidebar-foreground shadow-lg transition-transform duration-200 ease-out outline-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none md:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <div data-collapsed="false" className="group/sidebar h-full">
              {sidebar}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
        <div className="flex flex-1 flex-col bg-background md:rounded-xl md:border md:shadow-sm">
          <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2 md:static md:rounded-t-xl md:px-3">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <ListIcon className="size-5" />
            </Button>
            <span className="flex items-center gap-2 text-sm font-semibold md:hidden">
              <CloudIcon weight="fill" className="size-5 text-brand" />
              Nimbus
            </span>
            <Button
              id="sidebar-toggle"
              variant="ghost"
              size="icon-sm"
              className="max-md:hidden"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={`${collapsed ? "Expand" : "Collapse"} sidebar (Ctrl+B)`}
              onClick={toggle}
            >
              <SidebarSimpleIcon />
            </Button>
            <div className="ml-auto flex items-center gap-1">{actions}</div>
          </header>
          <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-10">{children}</main>
        </div>
      </div>
    </div>
  )
}

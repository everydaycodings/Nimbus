// What the person can do inside a vault. Each one says how it went in a snackbar, like useFileActions; the web's
// order of steps is kept (components/vault-browser.tsx), because the server can't check names or move data for us.
import type { Instance, Item, Me, PreviewResponse, RestoreVaultNodesResponse } from "@nimbus/shared/api"
import { extOf, mimeOf, zipName } from "@nimbus/shared/file-rules"
import { useQueryClient } from "@tanstack/react-query"
import { Directory, File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"
import { useMemo } from "react"

import { useSnack } from "@/components/snackbar"
import { useUploader } from "@/components/uploader"
import { errorText } from "./api"
import { fetchTo } from "./file-cache"
import { useApi } from "./files"
import { track, useTransfers } from "./transfers"
import type { NativeJob } from "./native"
import { applyAnswers, type Entry } from "./upload-plan"
import { engine } from "./uploads"
import { awaitDone, cancelled, decryptTemp, decryptTo, knownRows, rememberJobs, zipTo, type VaultNative } from "./vault"
import { foldersNeeded, kidsOf, lower, nameError, planClashes, renameKept, withPaths, type VaultEntry } from "./vault-rules"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const what = (list: { name: string }[]) => (list.length === 1 ? `“${list[0].name}”` : plural(list.length, "item"))

export function useVaultOps(vaultId: string, vn: VaultNative, all: VaultEntry[], reload: () => void) {
  const api = useApi()
  const snack = useSnack()
  const client = useQueryClient()
  const uploader = useUploader()
  const transfers = useTransfers()

  return useMemo(() => {
    const base = `/vaults/${vaultId}`
    const seal = async (name: string, mime: string | null) => JSON.parse(await vn.vaultSealName(api.id, vaultId, name, mime)) as { sealed: string; tag: string }
    const changed = () => {
      reload()
      client.invalidateQueries({ queryKey: [api.id, "vaults"] })
    }
    // Quiet success is a snackbar; failure is one too. Returns whether it worked.
    const run = async (task: () => Promise<unknown>, text: string, undo?: () => void) => {
      try {
        await task()
        changed()
        snack({ text, undo })
        return true
      } catch (e) {
        snack({ text: errorText(e), error: true })
        return false
      }
    }

    const restore = async (list: VaultEntry[]) => {
      const clash: VaultEntry[] = []
      const ok: VaultEntry[] = []
      const live = new Map(all.filter((e) => !e.trashedAt).map((e) => [e.id, e]))
      for (const n of list) {
        const dest = n.parentId && live.has(n.parentId) ? n.parentId : null
        ;(kidsOf(all, dest).some((k) => k.id !== n.id && lower(k.name) === lower(n.name)) ? clash : ok).push(n)
      }
      try {
        const res: RestoreVaultNodesResponse = ok.length ? await api.post(`${base}/nodes/restore`, { ids: ok.map((n) => n.id) }) : {}
        changed()
        if (clash.length || res.kept)
          snack({ text: `${clash.length ? clash.map((n) => `“${n.name}”`).join(", ") : plural(res.kept!, "item")} couldn't come back because something with the same name is in its folder now. Rename that one, then restore again.`, error: true })
        else snack({ text: `Restored ${what(list)}.` })
      } catch (e) {
        snack({ text: errorText(e), error: true })
      }
    }

    // ---- Uploading ----

    // Names are checked here, folders are made first, then each file is queued under its folder's token.
    // `whole`: every file was queued; `queued`: how many files that is.
    const send = async (input: Entry[], target: string | null) => {
      const none = { whole: false, queued: 0 }
      const [instance, me] = await Promise.all([api.get<Instance>("/instance"), api.get<Me>("/me")])
      let list = input.filter((e) => {
        if (!e.uri) return true
        const name = e.path.split("/").pop()!
        const why = instance.blockedExtensions.includes(extOf(name)) ? "That type can't be uploaded here." : instance.maxUploadBytes !== null && e.size > instance.maxUploadBytes ? "This file is over the upload limit." : null
        if (why) engine.refuse(api.id, name, why)
        return !why
      })
      const planned = planClashes(all, target, list)
      const answers = await uploader.ask(planned.conflicts, true)
      if (!answers) return none
      const { list: answered, versions } = applyAnswers(planned.list, planned.conflicts, answers)
      list = renameKept(answered, planned.conflicts, answers)
      const files = list.filter((e) => e.uri)
      const whole = files.length === input.filter((e) => e.uri).length

      const { ids, make } = foldersNeeded(all, target, list)
      if (make.length) {
        const folders = await Promise.all(make.map(async (m) => ({ key: m.key, parent: m.parent, ...(await seal(m.name, null)) })))
        const res = await api.post<{ ids: Record<string, string> }>(`${base}/folders`, { folders: folders.map((f) => ({ key: f.key, parent: f.parent, name: f.sealed, tag: f.tag })) })
        for (const [k, id] of Object.entries(res.ids)) ids.set(k, id)
        changed()
      }
      if (!files.length) return { whole, queued: 0 }

      const parentOf = (p: string) => ids.get(p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") ?? null
      const groups = new Map<string | null, Entry[]>()
      for (const f of files) groups.set(parentOf(f.path), [...(groups.get(parentOf(f.path)) ?? []), f])
      const plan = await api.post<{ tokens: string[] }>(`${base}/uploads/plan`, {
        groups: [...groups].map(([parentId, g]) => ({ parentId, sizes: g.map((f) => f.size) })),
      })
      // ponytail: no mobile-data question for vault uploads; add it with the uploader's DataDialog if people ask.
      const jobs: NativeJob[] = []
      let g = 0
      for (const [parentId, group] of groups) {
        const token = plan.tokens[g++]
        for (const f of group) {
          const name = f.path.split("/").pop()!
          const sealed = await seal(name, f.mime || null)
          jobs.push({
            accountId: api.id,
            server: api.account.server,
            tusUrl: instance.tusUrl,
            uri: f.uri!,
            name,
            size: f.size,
            mime: f.mime ?? "",
            path: f.path,
            planToken: token,
            parentId,
            onConflict: versions.has(f.path) ? "version" : "rename",
            wifiOnly: false,
            speedCap: me.uploadSpeedBytes ?? null,
            vault: { vaultId, sealedName: sealed.sealed, nameTag: sealed.tag, replaces: versions.has(f.path) ? planned.existing.get(f.path) : undefined },
          })
        }
      }
      rememberJobs(jobs)
      await engine.add(jobs, api.account.token)
      return { whole, queued: jobs.length }
    }

    // ---- Downloading ----

    const filesIn = (list: VaultEntry[]) => withPaths(all, list).filter((x) => x.entry.kind === "file")

    return {
      send,
      restore,

      createFolder: async (parent: string | null, name: string) => {
        const bad = nameError(name, kidsOf(all, parent))
        if (bad) return bad
        try {
          const s = await seal(name.trim(), null)
          await api.post(`${base}/folders`, { folders: [{ key: "new", parent, name: s.sealed, tag: s.tag }] })
          changed()
          snack({ text: `Created folder “${name.trim()}”.` })
        } catch (e) {
          return errorText(e)
        }
      },
      rename: async (entry: VaultEntry, name: string) => {
        const bad = nameError(name, kidsOf(all, entry.parentId), entry.id)
        if (bad) return bad
        try {
          const s = await seal(name.trim(), entry.mime)
          await api.patch(`${base}/nodes/${entry.id}`, { name: s.sealed, tag: s.tag })
          changed()
          snack({ text: `Renamed to “${name.trim()}”.` })
        } catch (e) {
          return errorText(e)
        }
      },
      move: async (list: VaultEntry[], target: string | null, to: string) => {
        const clash = list.find((m) => kidsOf(all, target).some((k) => k.id !== m.id && lower(k.name) === lower(m.name)))
        if (clash) return snack({ text: `Something named “${clash.name}” is already in that folder.`, error: true })
        run(() => api.post(`${base}/nodes/move`, { ids: list.map((m) => m.id), parentId: target }), `Moved ${what(list)} to ${to}.`)
      },
      trash: (list: VaultEntry[]) =>
        run(() => api.post(`${base}/nodes/trash`, { ids: list.map((n) => n.id) }), `Moved ${what(list)} to this vault's trash.`, () => restore(list)),
      remove: (list: VaultEntry[]) => run(() => api.post(`${base}/nodes/delete`, { ids: list.map((n) => n.id) }), `Deleted ${what(list)} forever.`),

      // The caller has already warned that this is an unencrypted copy.
      download: async (list: VaultEntry[]) => {
        const dir = await transfers.destination()
        if (!dir) return
        const one = list.length === 1 && list[0].kind === "file" ? list[0] : null
        const files = filesIn(list)
        if (!files.length) return snack({ text: "There are no files in that to download." })
        let out: File | null = null
        try {
          if (one) {
            out = dir.createFile(one.name, one.mime ?? mimeOf(null, one.name))
            const dest = out.uri
            await track(one.name, one.size, (progress, signal) => decryptTo(api, vn, vaultId, one.id, dest, progress, signal))
          } else {
            const name = zipName("nimbus_vault")
            out = dir.createFile(name, "application/zip")
            const dest = out.uri
            const total = files.reduce((n, f) => n + f.entry.size, 0)
            await track(name, total, (progress, signal) => zipTo(api, vn, vaultId, files.map((f) => ({ id: f.entry.id, path: f.path })), dest, progress, signal))
          }
          snack({ text: `Saved “${out.name || (one ? one.name : "ZIP")}”. It isn't encrypted.` })
        } catch (e) {
          try {
            out?.delete()
          } catch {}
          if (!cancelled(e)) snack({ text: errorText(e), error: true })
        }
      },
      openWith: async (entry: VaultEntry) => {
        try {
          const item = { ...entry } as unknown as Item
          const file = await track(entry.name, entry.size, (progress, signal) => decryptTemp(api, vn, vaultId, item, progress, signal))
          const mimeType = entry.mime ?? mimeOf(null, entry.name)
          if (await file.canPreview({ mimeType }).catch(() => false)) await file.preview({ mimeType, title: entry.name })
          else await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: entry.name })
        } catch (e) {
          if (!cancelled(e)) snack({ text: errorText(e), error: true })
        }
      },

      // From My files: each file comes to the phone, goes in encrypted, and the originals are deleted only once every
      // one has landed (the web's order).
      moveIn: async (items: Item[], target: string | null) => {
        const dir = new Directory(Paths.cache, "vault-in", String(Date.now()))
        try {
          snack({ text: "Getting the files ready to encrypt…" })
          const entries: Entry[] = []
          let n = 0
          const walk = async (item: Item, path: string) => {
            if (item.kind === "folder") {
              entries.push({ path, size: 0 })
              let cursor: string | null = null
              do {
                const page: { items: Item[]; nextCursor: string | null } = await api.get(`/folders/${item.id}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
                for (const k of page.items) await walk(k, `${path}/${k.name}`)
                cursor = page.nextCursor
              } while (cursor)
              return
            }
            const file = await fetchTo(new File(dir, String(n++)), async () => (await api.get<PreviewResponse>(`/items/${item.id}/preview`)).url)
            // The originals are deleted afterwards, so a short copy must stop the move here.
            if (file.size !== item.size) throw new Error(`“${item.name}” didn't download completely.`)
            entries.push({ path, size: file.size, uri: file.uri, mime: item.mime ?? mimeOf(null, item.name) })
          }
          for (const i of items) await walk(i, i.name)
          const known = knownRows()
          const sent = await send(entries, target)
          const ok = await awaitDone(api.id, (r) => r.vaultId === vaultId, known, sent.queued)
          if (ok && sent.whole) {
            const ids = items.map((i) => i.id)
            await api.post("/items/trash", { ids })
            await api.post("/items/delete", { ids })
            client.invalidateQueries({ queryKey: [api.id] })
            snack({ text: `Moved ${plural(items.length, "item")} into this vault. The originals are deleted.` })
          } else snack({ text: "Some items stayed out of the vault, so the originals in My files are kept." })
        } catch (e) {
          snack({ text: `${errorText(e)} Nothing was deleted.`, error: true })
        } finally {
          if (dir.exists) dir.delete()
        }
      },

      // Back to My files: decrypted here, uploaded as ordinary files, and the vault copies go only once every file landed.
      moveOut: async (list: VaultEntry[], dest: string | null, to: string) => {
        const dir = new Directory(Paths.cache, "vault-out", String(Date.now()))
        try {
          const entries: Entry[] = []
          let n = 0
          for (const { entry, path } of withPaths(all, list)) {
            if (entry.kind === "folder") {
              entries.push({ path, size: 0 })
              continue
            }
            const file = new File(dir, String(n++))
            if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
            await track(entry.name, entry.size, (progress, signal) => decryptTo(api, vn, vaultId, entry.id, file.uri, progress, signal))
            entries.push({ path, size: entry.size, uri: file.uri, mime: entry.mime ?? mimeOf(null, entry.name) })
          }
          const known = knownRows()
          if (!(await uploader.send(api.account, dest, entries))) return
          const mine = engine.rows().filter((r) => r.accountId === api.id && !known.has(r.id) && !r.vaultId && r.status !== "refused")
          const wanted = entries.filter((e) => e.uri).length
          // The temp copies stay until the uploads that read them are done.
          const landed = await awaitDone(api.id, (r) => !r.vaultId && r.status !== "refused", known, mine.length)
          const ok = landed && mine.length === wanted
          if (ok) {
            await api.post(`${base}/nodes/delete`, { ids: list.map((e) => e.id) })
            changed()
            client.invalidateQueries({ queryKey: [api.id] })
            snack({ text: `Moved ${plural(list.length, "item")} to ${to}. They're no longer encrypted.` })
          } else snack({ text: "Some items didn't make it to My files, so the vault copies are kept." })
        } catch (e) {
          if (!cancelled(e)) snack({ text: `${errorText(e)} Nothing was deleted.`, error: true })
        } finally {
          if (dir.exists) dir.delete()
        }
      },
    }
  }, [api, vn, vaultId, all, reload, client, snack, uploader, transfers])
}

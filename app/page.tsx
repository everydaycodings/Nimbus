'use client'

import { useEffect, useState } from 'react'
import { useSession, useUser, UserButton } from '@clerk/nextjs'
import { createClient } from '@supabase/supabase-js'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default function Home() {
  const [tasks, setTasks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')

  const { user } = useUser()
  const { session } = useSession()

  function createClerkSupabaseClient() {
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_KEY!,
      {
        async accessToken() {
          return session?.getToken() ?? null
        },
      }
    )
  }

  const client = createClerkSupabaseClient()

  useEffect(() => {
    if (!user) return

    async function loadTasks() {
      setLoading(true)
      const { data } = await client.from('tasks').select()
      setTasks(data || [])
      setLoading(false)
    }

    loadTasks()
  }, [user])

  async function createTask(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    await client.from('tasks').insert({ name })
    setName('')

    const { data } = await client.from('tasks').select()
    setTasks(data || [])
  }

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* 🔝 Header */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-xl font-semibold">☁️ Nimbus</h1>

        <div className="flex items-center">
          <UserButton />
        </div>
      </header>

      {/* 📦 Main */}
      <main className="max-w-2xl mx-auto p-6 space-y-6">

        {/* ➕ Add Task */}
        <Card>
          <CardContent className="p-4">
            <form onSubmit={createTask} className="flex gap-2">
              <Input
                placeholder="Enter task..."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit">Add</Button>
            </form>
          </CardContent>
        </Card>

        {/* 📋 Tasks */}
        <div className="space-y-3">
          {loading && (
            <p className="text-muted-foreground">Loading...</p>
          )}

          {!loading && tasks.length === 0 && (
            <p className="text-muted-foreground">No tasks yet</p>
          )}

          {tasks.map((task) => (
            <Card key={task.id}>
              <CardContent className="p-4">
                {task.name}
              </CardContent>
            </Card>
          ))}
        </div>

      </main>
    </div>
  )
}
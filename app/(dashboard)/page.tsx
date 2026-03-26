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
    <div className="min-h-screen bg-background">

      {/* 📦 Main */}
      <main className="max-w-2xl mx-auto p-6 space-y-6">

      </main>
    </div>
  )
}
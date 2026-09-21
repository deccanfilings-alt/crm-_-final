'use client'

import { useEffect, useState } from 'react'
import { Plus, Book } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import Link from 'next/link'

export default function KnowledgeBasesPage() {
  const { account } = useAuth()
  const [kbs, setKbs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  useEffect(() => {
    if (account?.id) {
      fetchKbs()
    }
  }, [account?.id])

  const fetchKbs = async () => {
    try {
      const res = await fetch(`/api/knowledge-bases?account_id=${account?.id}`)
      if (res.ok) {
        const data = await res.json()
        setKbs(data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/knowledge-bases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: account?.id,
          name: newName.trim(),
          description: newDesc.trim()
        })
      })
      if (res.ok) {
        const newKb = await res.json()
        setKbs([newKb, ...kbs])
        setNewName('')
        setNewDesc('')
      }
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return <div className="p-8">Loading Knowledge Bases...</div>
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Knowledge Bases</h2>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Create Card */}
        <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
          <form onSubmit={handleCreate} className="flex flex-col space-y-4 p-6">
            <h3 className="font-semibold leading-none tracking-tight">Create New KB</h3>
            <div className="space-y-2 text-sm">
              <label>Name</label>
              <Input 
                placeholder="e.g. Help Center Docs" 
                value={newName} 
                onChange={(e) => setNewName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2 text-sm">
              <label>Description (optional)</label>
              <Textarea 
                placeholder="What kind of knowledge does this contain?" 
                value={newDesc} 
                onChange={(e) => setNewDesc(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Create
                </>
              )}
            </Button>
          </form>
        </div>

        {/* List of KBs */}
        {kbs.map((kb) => (
          <Link 
            key={kb.id} 
            href={`/knowledge-bases/${kb.id}`}
            className="rounded-xl border bg-card text-card-foreground shadow-sm hover:border-primary transition-colors flex flex-col p-6"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <Book className="h-5 w-5" />
              </div>
              <h3 className="font-semibold leading-none tracking-tight">{kb.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground flex-1">
              {kb.description || 'No description provided.'}
            </p>
            <div className="text-xs text-muted-foreground mt-4">
              Created {new Date(kb.created_at).toLocaleDateString()}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

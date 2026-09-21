'use client'

import { useEffect, useState, useRef, use } from 'react'
import { ArrowLeft, Upload, FileText, Loader2, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function KnowledgeBaseDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  
  const [documents, setDocuments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchDocuments()
  }, [id])

  const fetchDocuments = async () => {
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/documents`)
      if (res.ok) {
        const data = await res.json()
        setDocuments(data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleUpload = async (file: File) => {
    if (!file) return
    if (file.type !== 'text/plain' && !file.name.endsWith('.md')) {
      setError('Only .txt and .md files are supported.')
      return
    }

    setUploading(true)
    setError(null)
    setWarning(null)
    
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`/api/knowledge-bases/${id}/documents`, {
        method: 'POST',
        body: formData
      })
      
      let data: any = null
      try {
        data = await res.json()
      } catch {
        setError(`Server error (HTTP ${res.status}): could not parse response`)
        return
      }
      
      if (!res.ok) {
        setError(data?.error || `Upload failed (HTTP ${res.status})`)
      } else {
        setDocuments((prev) => [data, ...prev])
        if (data.embedding_warning) {
          setWarning(`Document saved without vector embeddings: ${data.embedding_warning}. Keyword search will be used instead.`)
        }
      }
    } catch (err: any) {
      console.error('Upload fetch error:', err)
      setError('Network error: ' + (err?.message || 'Could not reach the server'))
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (docId: string) => {
    if (!confirm('Delete this document? This cannot be undone.')) return
    setDeletingId(docId)
    try {
      const res = await fetch(`/api/knowledge-bases/${id}/documents/${docId}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        setDocuments((prev) => prev.filter((d) => d.id !== docId))
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data?.error || 'Failed to delete document')
      }
    } catch (err: any) {
      setError('Network error: ' + err?.message)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="p-8">Loading documents...</div>

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-4">
        <Link href="/knowledge-bases" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h2 className="text-3xl font-bold tracking-tight">Documents</h2>
      </div>

      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-4">
        <div className="md:col-span-1 space-y-4">
          <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-6">
            <h3 className="font-semibold leading-none tracking-tight mb-4">Upload Document</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Upload a .txt, .md, .pdf, or .docx file. It will be chunked and embedded automatically.
            </p>
            
            {error && (
              <div className="mb-4 text-sm text-red-500 bg-red-500/10 p-3 rounded-md">
                {error}
              </div>
            )}
            {warning && (
              <div className="mb-4 text-sm text-amber-500 bg-amber-500/10 p-3 rounded-md">
                ⚠️ {warning}
              </div>
            )}
            
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept=".txt,.md,text/plain,.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
                e.target.value = ''
              }}
            />
            
            <Button 
              className="w-full" 
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Select File
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="md:col-span-2 lg:col-span-3 space-y-4">
          <h3 className="text-lg font-medium">
            Uploaded Files <span className="text-sm font-normal text-muted-foreground">({documents.length})</span>
          </h3>
          {documents.length === 0 ? (
            <div className="text-sm text-muted-foreground p-8 border border-dashed rounded-lg text-center">
              No documents uploaded yet.
            </div>
          ) : (
            <div className="border rounded-lg divide-y">
              {documents.map((doc) => (
                <div key={doc.id} className="p-4 flex items-center gap-4">
                  <div className="p-2 bg-muted rounded shrink-0">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{doc.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      Uploaded {new Date(doc.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                    disabled={deletingId === doc.id}
                    onClick={() => handleDelete(doc.id)}
                    title="Delete document"
                  >
                    {deletingId === doc.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

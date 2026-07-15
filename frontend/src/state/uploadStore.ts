/**
 * Module-level upload-item store.
 *
 * Req 1.5 requires per-file progress to persist "regardless of whether the
 * user navigates away from or returns to the upload screen" -- a plain
 * component-local `useState` would reset on unmount/remount when React
 * Router swaps routes, so the item list and a tiny pub/sub live here
 * instead, outside any component's lifecycle, for the lifetime of the SPA
 * session (Property 2).
 */
import { useEffect, useState } from 'react'

export type FileStatus = 'pending' | 'uploading' | 'uploaded' | 'error'

export interface UploadItem {
  id: string
  file: File
  key: string | null
  status: FileStatus
  progress: number
}

let items: UploadItem[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function getUploadItems(): UploadItem[] {
  return items
}

export function addUploadItems(newItems: UploadItem[]): void {
  items = [...items, ...newItems]
  notify()
}

export function updateUploadItem(id: string, patch: Partial<UploadItem>): void {
  items = items.map((item) => (item.id === id ? { ...item, ...patch } : item))
  notify()
}

export function useUploadItems(): UploadItem[] {
  const [snapshot, setSnapshot] = useState(items)
  useEffect(() => {
    const listener = () => setSnapshot(items)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])
  return snapshot
}

let idCounter = 0
export function nextUploadItemId(): string {
  idCounter += 1
  return `upload-${idCounter}`
}

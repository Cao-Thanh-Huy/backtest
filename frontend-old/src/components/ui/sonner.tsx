'use client'

import { Toaster as Sonner } from 'sonner'

export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      richColors
      closeButton
      theme="dark"
      toastOptions={{
        style: {
          background: '#0f172a',
          border: '1px solid #334155',
          color: '#e2e8f0',
        },
      }}
    />
  )
}

import type { Metadata } from 'next'
import './globals.css'
import './index-theme.css'
import { Sidebar } from '@/components/ui/Sidebar'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'Quant ML Platform',
  description: 'Dynamic Quant Research & ML Trading Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-surface text-zinc-100 min-h-screen flex antialiased">
        <Providers>
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </Providers>
      </body>
    </html>
  )
}

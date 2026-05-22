'use client'
import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadDataset, listDatasets } from '@/lib/api'
import { clsx } from 'clsx'

export default function DataHubPage() {
  const qc = useQueryClient()
  const [symbol, setSymbol] = useState('')
  const [timeframe, setTimeframe] = useState('1d')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')

  const { data: datasets } = useQuery({
    queryKey: ['datasets'],
    queryFn: () => listDatasets().then((r) => r.data),
  })

  const uploadMut = useMutation({
    mutationFn: () => {
      const fd = new FormData()
      fd.append('symbol', symbol.toUpperCase())
      fd.append('timeframe', timeframe)
      fd.append('file', file!)
      return uploadDataset(fd)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datasets'] })
      setFile(null); setSymbol(''); setError('')
    },
    onError: (e: any) => setError(e.response?.data?.detail || 'Upload failed'),
  })

  const onDrop = useCallback((accepted: File[]) => setFile(accepted[0] ?? null), [])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'application/octet-stream': ['.parquet'] },
    maxFiles: 1,
  })

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Data Hub</h1>

      {/* Upload card */}
      <div className="card space-y-4">
        <h2 className="text-lg font-semibold">Upload OHLCV Dataset</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Symbol</label>
            <input className="input" placeholder="BTCUSDT" value={symbol} onChange={e => setSymbol(e.target.value)} />
          </div>
          <div>
            <label className="label">Timeframe</label>
            <select className="input" value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              {['1m','5m','15m','1h','4h','1d'].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-brand-500 bg-brand-500/10' : 'border-surface-border hover:border-zinc-500',
          )}
        >
          <input {...getInputProps()} />
          {file ? (
            <p className="text-green-400">✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
          ) : (
            <p className="text-zinc-400">Drop CSV or Parquet file here, or click to browse</p>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          className="btn-primary"
          disabled={!file || !symbol || uploadMut.isPending}
          onClick={() => uploadMut.mutate()}
        >
          {uploadMut.isPending ? 'Uploading…' : 'Upload Dataset'}
        </button>
      </div>

      {/* Dataset list */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Uploaded Datasets</h2>
        {!datasets?.length ? (
          <p className="text-zinc-500 text-sm">No datasets yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-400 text-left border-b border-surface-border">
                <th className="pb-2">Symbol</th><th className="pb-2">Timeframe</th>
                <th className="pb-2">Rows</th><th className="pb-2">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d: any) => (
                <tr key={d.id} className="border-b border-surface-border/50 hover:bg-surface/50">
                  <td className="py-2 font-medium text-brand-500">{d.symbol}</td>
                  <td className="py-2">{d.timeframe}</td>
                  <td className="py-2">{d.row_count?.toLocaleString()}</td>
                  <td className="py-2 text-zinc-400">{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

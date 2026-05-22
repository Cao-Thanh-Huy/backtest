import React, { useRef, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { Play, Copy, CheckCheck, RotateCcw } from 'lucide-react'
import { useDocStore } from '../store/docStore'
import * as api from '../api/client'

/**
 * MonacoSQL — Monaco Editor tích hợp Intent-based Injection.
 *
 * Props:
 *  - defaultValue: string  — SQL mặc định ban đầu (thường là DDL của bảng)
 *  - schema: string        — Schema context cho query
 *  - onRunResult: fn       — Callback khi có kết quả (rows, columns, error)
 *  - height: number        — Chiều cao editor (default: 320px)
 */
export default function MonacoSQL({ defaultValue = '', schema = 'bronze', onRunResult, height = 320 }) {
  const editorRef = useRef(null)
  const monacoRef = useRef(null)
  const [running, setRunning]   = React.useState(false)
  const [copied, setCopied]     = React.useState(false)

  const { pendingInject, clearPendingInject } = useDocStore()

  // ── Intent-based Injection Bridge ─────────────────────────────────────────
  // Khi docStore có pendingInject, Monaco nhận và dùng executeEdits()
  // Đảm bảo Undo Stack KHÔNG bị phá — Ctrl+Z vẫn hoạt động hoàn hảo.
  useEffect(() => {
    if (!pendingInject || !editorRef.current) return
    const editor = editorRef.current
    const { content, mode } = pendingInject

    const range = mode === 'replace'
      ? editor.getModel().getFullModelRange()
      : editor.getSelection()

    editor.executeEdits('docs_injector', [{
      range,
      text: content,
      forceMoveMarkers: true,
    }])

    // Bôi xanh đoạn vừa inject để user nhận ra ngay
    const model = editor.getModel()
    const lastLine = model.getLineCount()
    const lastCol  = model.getLineMaxColumn(lastLine)
    editor.setSelection({
      startLineNumber: 1, startColumn: 1,
      endLineNumber: lastLine, endColumn: lastCol,
    })

    editor.focus()           // Trả focus về editor để gõ tiếp luôn
    clearPendingInject()     // Xóa lệnh đã xử lý
  }, [pendingInject])

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleEditorDidMount(editor, monaco) {
    editorRef.current  = editor
    monacoRef.current  = monaco

    // Shortcut Ctrl+Enter để chạy query bên trong editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, handleRun)
  }

  async function handleRun() {
    if (!editorRef.current) return
    const sql = editorRef.current.getValue().trim()
    if (!sql) return

    setRunning(true)
    try {
      const data = await api.executeQuery({ sql, catalog: 'iceberg', schema_name: schema })
      onRunResult?.({ type: 'success', data })
    } catch (e) {
      onRunResult?.({ type: 'error', message: e.message })
    }
    setRunning(false)
  }

  function handleCopy() {
    if (!editorRef.current) return
    const text = editorRef.current.getValue()
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleReset() {
    editorRef.current?.setValue(defaultValue)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px', background: 'var(--bg-glass)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
          SQL Editor · <kbd style={{ fontSize: 10, opacity: 0.6 }}>Ctrl+Enter</kbd> để chạy
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleReset} title="Reset về DDL gốc"
            style={toolBtnStyle}>
            <RotateCcw size={12} />
          </button>
          <button onClick={handleCopy}
            style={toolBtnStyle}>
            {copied ? <><CheckCheck size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
          </button>
          <button onClick={handleRun} disabled={running}
            style={{ ...toolBtnStyle, background: 'rgba(139,92,246,0.2)', color: '#a78bfa', borderColor: 'rgba(139,92,246,0.3)' }}>
            <Play size={12} /> {running ? 'Đang chạy...' : 'Chạy'}
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <Editor
        height={height}
        defaultLanguage="sql"
        defaultValue={defaultValue}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        options={{
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          lineNumbers: 'on',
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          padding: { top: 10, bottom: 10 },
          renderLineHighlight: 'all',
          cursorBlinking: 'smooth',
          smoothScrolling: true,
          automaticLayout: true,
        }}
        loading={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height, background: '#1e1e1e', color: '#888', fontSize: 12 }}>
            Đang tải Editor...
          </div>
        }
      />
    </div>
  )
}

const toolBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 4,
  background: 'var(--bg-glass)', border: '1px solid var(--border)',
  color: 'var(--text-muted)', borderRadius: 5, padding: '3px 9px',
  fontSize: 11, cursor: 'pointer',
}

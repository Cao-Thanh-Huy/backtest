import React, { useState } from 'react'
import { useInView } from 'react-intersection-observer'
import { useDocStore } from '../../store/docStore'
import { Zap, CheckCircle2, Info, AlertTriangle, Lightbulb, ChevronRight } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Callout
// Dùng trong MDX: <Callout type="tip">Nội dung...</Callout>
// type: 'tip' | 'warning' | 'info' | 'danger'
// ─────────────────────────────────────────────────────────────────────────────
const CALLOUT_CONFIG = {
  tip:     { icon: <Lightbulb size={15} />,      color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)', label: 'Mẹo'     },
  info:    { icon: <Info size={15} />,            color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.25)', label: 'Lưu ý'   },
  warning: { icon: <AlertTriangle size={15} />,   color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.25)', label: 'Cảnh báo' },
  danger:  { icon: <AlertTriangle size={15} />,   color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',  label: 'Nguy hiểm' },
}

export function Callout({ type = 'info', title, children }) {
  const cfg = CALLOUT_CONFIG[type] ?? CALLOUT_CONFIG.info
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 14px',
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderLeft: `3px solid ${cfg.color}`,
      borderRadius: 8, margin: '12px 0',
    }}>
      <span style={{ color: cfg.color, flexShrink: 0, marginTop: 1 }}>{cfg.icon}</span>
      <div>
        {title && (
          <div style={{ fontSize: 12, fontWeight: 700, color: cfg.color, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            {title ?? cfg.label}
          </div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text-secondary)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CodeBlock
// Dùng trong MDX: <CodeBlock language="sql" blockId="step-1" injectMode="cursor">
//   SELECT * FROM ...
// </CodeBlock>
// ─────────────────────────────────────────────────────────────────────────────
export function CodeBlock({ language = 'sql', blockId, injectMode = 'cursor', children }) {
  const { docState, requestInject, markInjected, openDrawer } = useDocStore()
  const isInjected = blockId && docState[blockId] === 'injected'

  // Lấy text thuần từ children (MDX truyền vào dạng string hoặc React node)
  const codeText = typeof children === 'string'
    ? children.trim()
    : children?.props?.children ?? ''

  function handleInject() {
    requestInject(codeText, injectMode, blockId)
    if (blockId) markInjected(blockId)
    // Chuyển tab sang SQL Editor tự động (nếu component cha expose setter)
    // Dispatch custom event để ModelManager lắng nghe
    window.dispatchEvent(new CustomEvent('de:switch-to-sql-tab'))
  }

  return (
    <div style={{
      margin: '10px 0',
      borderRadius: 8,
      overflow: 'hidden',
      border: isInjected ? '1px solid rgba(16,185,129,0.4)' : '1px solid var(--border)',
      opacity: isInjected ? 0.6 : 1,
      transition: 'opacity 0.3s ease, border-color 0.3s ease',
    }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 12px', background: 'var(--bg-glass)',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', textTransform: 'uppercase' }}>
          {language}
        </span>
        {isInjected ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#10b981' }}>
            <CheckCircle2 size={12} /> Đã inject
          </span>
        ) : (
          blockId && (
            <button onClick={handleInject} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)',
              color: '#a78bfa', borderRadius: 5, padding: '3px 9px', fontSize: 11,
              cursor: 'pointer', fontWeight: 600, transition: 'all 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,0.28)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(139,92,246,0.15)'}
            >
              <Zap size={11} /> Inject vào Editor
            </button>
          )
        )}
      </div>
      {/* Code area */}
      <pre style={{
        margin: 0, padding: '12px 14px',
        background: 'var(--bg-surface)',
        fontSize: 12, lineHeight: 1.7,
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        overflowX: 'auto', color: 'var(--text)',
        whiteSpace: 'pre',
      }}>
        <code>{codeText}</code>
      </pre>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CodeDiff — Lazy-mounted khi scroll tới (dùng IntersectionObserver)
// Dùng trong MDX: <CodeDiff before="..." after="..." language="sql" />
// ─────────────────────────────────────────────────────────────────────────────
export function CodeDiff({ before = '', after = '', language = 'sql' }) {
  const { ref, inView } = useInView({ threshold: 0.1, triggerOnce: true })

  // Tính diff đơn giản dòng-theo-dòng
  function computeDiff(a, b) {
    const aLines = a.trim().split('\n')
    const bLines = b.trim().split('\n')
    const result = []

    const maxLen = Math.max(aLines.length, bLines.length)
    // Naive line diff: removed từ before, added từ after
    aLines.forEach(l => result.push({ type: 'removed', line: l }))
    bLines.forEach(l => result.push({ type: 'added',   line: l }))

    return result
  }

  const lines = inView ? computeDiff(before, after) : []

  return (
    <div ref={ref} style={{
      margin: '10px 0', borderRadius: 8,
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      <div style={{
        padding: '5px 12px', background: 'var(--bg-glass)',
        borderBottom: '1px solid var(--border)',
        fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace',
        textTransform: 'uppercase',
      }}>
        {language} · diff
      </div>
      {!inView ? (
        // Placeholder skeleton — không tốn DOM khi chưa nhìn thấy
        <div style={{ height: 60, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Cuộn để xem diff...</span>
        </div>
      ) : (
        <pre style={{
          margin: 0, overflowX: 'auto',
          fontFamily: 'JetBrains Mono, Consolas, monospace',
          fontSize: 12, lineHeight: 1.7,
        }}>
          {lines.map((item, i) => (
            <div key={i} style={{
              padding: '0 14px',
              background: item.type === 'removed'
                ? 'rgba(239,68,68,0.08)'
                : 'rgba(16,185,129,0.08)',
              color: item.type === 'removed' ? '#f87171' : '#6ee7b7',
              whiteSpace: 'pre',
            }}>
              {item.type === 'removed' ? '- ' : '+ '}{item.line}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step — Hiển thị một bước trong guide: <Step num={1} title="Tạo bảng">...</Step>
// ─────────────────────────────────────────────────────────────────────────────
export function Step({ num, title, children }) {
  return (
    <div style={{ display: 'flex', gap: 14, margin: '18px 0' }}>
      <div style={{
        flexShrink: 0, width: 28, height: 28,
        borderRadius: '50%', background: 'rgba(139,92,246,0.2)',
        border: '1px solid rgba(139,92,246,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 12, fontWeight: 700, color: '#a78bfa', marginTop: 2,
      }}>
        {num}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)', marginBottom: 8 }}>
          {title}
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Map component duy nhất được phép dùng trong các file .mdx
// Mọi HTML tag không có trong map này sẽ được override về style DE Studio
// ─────────────────────────────────────────────────────────────────────────────
export const allowedComponents = {
  // Custom components
  Callout,
  CodeBlock,
  CodeDiff,
  Step,
  // Override heading + paragraph để nhất quán theme DE Studio
  h1: ({ children }) => (
    <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginBottom: 6, marginTop: 20, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginTop: 24, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
      <ChevronRight size={13} style={{ color: 'var(--primary)' }} />{children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginTop: 16, marginBottom: 6 }}>
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)', margin: '6px 0' }}>
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text-secondary)', paddingLeft: 20, margin: '6px 0' }}>
      {children}
    </ul>
  ),
  li: ({ children }) => <li style={{ marginBottom: 2 }}>{children}</li>,
  strong: ({ children }) => <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{children}</strong>,
  code: ({ children }) => (
    <code style={{
      background: 'var(--bg-glass)', padding: '1px 6px', borderRadius: 4,
      fontFamily: 'JetBrains Mono, monospace', fontSize: '0.85em',
      color: 'var(--primary)',
    }}>
      {children}
    </code>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} />,
}

import React, { useEffect, useRef } from 'react'
import { BookOpen, X, ChevronRight, TriangleAlert } from 'lucide-react'
import { useDocStore } from '../store/docStore'

/**
 * ProgressiveAssistToast
 * Fixed bottom-LEFT để không đụng error toast bên RIGHT.
 * Khi click "Xem Hướng Dẫn":
 *  1. Đặt pendingHighlight vào store (DocGuideDrawer sẽ đọc lúc mount)
 *  2. Mở drawer
 *  3. Đóng toast
 */
export default function ProgressiveAssistToast() {
  const {
    assistToast, dismissAssistToast, openDrawer, isDrawerOpen, highlightStepId,
    setPendingHighlight,
  } = useDocStore()
  const timerRef = useRef(null)

  // Auto-dismiss sau 7 giây
  useEffect(() => {
    if (!assistToast) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => dismissAssistToast(), 7000)
    return () => clearTimeout(timerRef.current)
  }, [assistToast])

  if (!assistToast) return null

  function handleOpenGuide() {
    // Lưu step cần highlight vào store TRƯỚC khi mở drawer
    // DocGuideDrawer sẽ đọc giá trị này lúc mount
    if (highlightStepId) {
      setPendingHighlight(highlightStepId)
    }
    openDrawer()
    dismissAssistToast()
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: 24,
      zIndex: 9999,
      maxWidth: 310,
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,158,11,0.35)',
      animation: 'assistSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      <style>{`
        @keyframes assistSlideIn {
          from { opacity: 0; transform: translateY(20px) scale(0.94); }
          to   { opacity: 1; transform: translateY(0)    scale(1); }
        }
      `}</style>

      {/* Amber top bar */}
      <div style={{ height: 3, background: 'linear-gradient(90deg, #f59e0b, #f97316)' }} />

      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid rgba(245,158,11,0.18)',
        borderTop: 'none',
        padding: '12px 13px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {/* Icon */}
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)',
          }}>
            <TriangleAlert size={14} style={{ color: '#f59e0b' }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 3 }}>
              Looks like something went wrong
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {assistToast.message}
            </div>
          </div>
          <button onClick={dismissAssistToast} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', padding: 2, flexShrink: 0,
            borderRadius: 4, display: 'flex',
          }}>
            <X size={13} />
          </button>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={dismissAssistToast} style={{
            flex: 1, padding: '6px 8px', borderRadius: 7,
            background: 'var(--bg-glass)', border: '1px solid var(--border)',
            color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontWeight: 500,
          }}>
            Dismiss
          </button>
          <button onClick={handleOpenGuide} style={{
            flex: 2, padding: '6px 10px', borderRadius: 7,
            background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(249,115,22,0.15))',
            border: '1px solid rgba(245,158,11,0.45)',
            color: '#fbbf24', fontSize: 11, cursor: 'pointer', fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}>
            <BookOpen size={12} /> View Guide <ChevronRight size={11} />
          </button>
        </div>

        {/* Hint khi modal đang mở che drawer */}
        <div style={{
          marginTop: 8, fontSize: 10, color: 'var(--text-muted)',
          textAlign: 'center', opacity: 0.7,
        }}>
          💡 Close the current dialog to see the Guide
        </div>
      </div>
    </div>
  )
}

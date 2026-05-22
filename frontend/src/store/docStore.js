import { create } from 'zustand'

const STREAK_TOAST_THRESHOLD    = 1   // >= 1 lỗi → Hiện assist toast
const STREAK_AUTO_OPEN_THRESHOLD = 2  // >= 2 lỗi → Tự mở Drawer

// Map keyword → stepId (kiểm tra theo thứ tự, match đầu tiên wins)
const TOPIC_RULES = [
  // Schema errors
  { match: ['SchemaAlreadyExists', 'schema already exists', 'Schema not found'], step: 'create-schema' },
  // Partition / table creation errors
  { match: ['partition', 'Partition', 'PARTITION'], step: 'create-table' },
  { match: ['format', 'FORMAT', 'already exists', 'TABLE'], step: 'create-table' },
  { match: ['SYNTAX_ERROR', 'mismatched input', 'unexpected token'], step: 'create-table' },
  // Column errors
  { match: ['column', 'Column', 'COLUMN', 'type mismatch', 'cast'], step: 'explore-table' },
  // CSV import errors
  { match: ['CSV', 'import', 'upload', 'file', 'Upload'], step: 'import-data' },
  // Optimize errors
  { match: ['OPTIMIZE', 'compaction', 'compact', 'vacuum', 'Vacuum'], step: 'optimize' },
  // Snapshot / time travel errors
  { match: ['snapshot', 'Snapshot', 'version', 'time travel'], step: 'time-travel' },
]

function detectTopic(errorMsg = '') {
  for (const rule of TOPIC_RULES) {
    if (rule.match.some(kw => errorMsg.includes(kw))) return rule.step
  }
  // Fallback generic → tạo bảng (đây là lỗi phổ biến nhất)
  return 'create-table'
}

const stepLabels = {
  'create-schema': 'Create Schema Layer',
  'create-table':  'Create Iceberg Table',
  'explore-table': 'Explore Tables',
  'import-data':   'Import CSV Data',
  'optimize':      'Performance Optimization',
  'time-travel':   'Time Travel & Rollback',
}

export const useDocStore = create((set, get) => ({

  // ── 1. Guide Drawer ────────────────────────────────────────────
  isDrawerOpen:  false,
  openDrawer:    () => set({ isDrawerOpen: true }),
  closeDrawer:   () => set({ isDrawerOpen: false }),
  toggleDrawer:  () => set(s => ({ isDrawerOpen: !s.isDrawerOpen })),

  // ── 2. Pending Highlight ───────────────────────────────────────
  // Store step cần được highlight khi Drawer mở.
  // DocGuideDrawer đọc giá trị này lúc mount (tránh race condition với event)
  pendingHighlight: null,
  setPendingHighlight: (stepId) => set({ pendingHighlight: stepId }),
  clearPendingHighlight: () => set({ pendingHighlight: null }),

  // ── 3. Progressive Assist ──────────────────────────────────────
  errorStreakCount: 0,
  lastErrorTopic:   null,
  highlightStepId:  null,
  assistToast:      null,

  /**
   * Gọi mỗi khi có API error trong ModelManager.
   * Tự động phân tích error → tăng streak → kích hoạt assist.
   */
  reportError: (errorMsg = '') => {
    const topic    = detectTopic(String(errorMsg))
    const state    = get()
    const newStreak = state.errorStreakCount + 1

    set({
      errorStreakCount: newStreak,
      lastErrorTopic:   topic,
      highlightStepId:  topic,
      assistToast: {
        message: `Check the "${stepLabels[topic]}" guide to resolve this error.`,
        stepId: topic,
      },
    })

    // Khi streak >= ngưỡng → tự mở Drawer + set pendingHighlight
    if (newStreak >= STREAK_AUTO_OPEN_THRESHOLD) {
      set({ isDrawerOpen: true, pendingHighlight: topic })
    }
  },

  /** Reset streak khi thao tác thành công */
  resetErrorStreak: () => set({
    errorStreakCount: 0,
    lastErrorTopic:   null,
    highlightStepId:  null,
  }),

  /** Dismiss assist toast */
  dismissAssistToast: () => set({ assistToast: null }),
}))

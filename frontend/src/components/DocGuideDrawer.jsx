import React, { useState, useEffect, useRef } from 'react'
import {
  X, BookOpen, ChevronRight, CheckCircle2, Circle,
  MousePointer2, Sparkles, AlertTriangle,
  XCircle,
} from 'lucide-react'
import { useDocStore } from '../store/docStore'

const GUIDE_STEPS = [
  {
    id: 'create-schema',
    icon: '🗂️',
    title: 'Create Schema Layer',
    subtitle: 'Organize data tiers with Medallion architecture',
    color: '#f59e0b',
    actions: [{ label: 'Click "New Schema" in the top bar → Enter a name → Click Create' }],
    sections: [
      {
        type: 'concept',
        title: 'What is Medallion Architecture?',
        body: 'A data organization pattern with three quality tiers, each represented as a separate Schema. Data flows from raw → cleaned → business-ready.',
      },
      {
        type: 'tiers',
        items: [
          {
            emoji: '🥉', name: 'bronze', color: '#cd7f32',
            title: 'Raw Layer',
            desc: 'Raw ingested data — untouched, exactly as received from the source.',
            example: 'CSV uploads, REST API responses, event logs from applications',
            rule: 'NEVER delete or modify data here. Bronze is the source of truth.',
          },
          {
            emoji: '🥈', name: 'silver', color: '#adb5bd',
            title: 'Cleaned Layer',
            desc: 'Validated, standardized data processed by Pipeline.',
            example: 'Nulls handled, date formats normalized, duplicates removed',
            rule: 'Do not import data manually here — use Pipeline to transform from bronze.',
          },
          {
            emoji: '🥇', name: 'gold', color: '#ffd700',
            title: 'Business Layer',
            desc: 'Aggregated, business-ready data for reporting and analytics.',
            example: 'daily_revenue, customer_ltv, weekly_order_summary',
            rule: 'Each gold table should have a clear business definition documented.',
          },
        ],
      },
      {
        type: 'naming',
        title: 'Schema Naming Rules',
        rules: [
          { ok: true,  text: 'bronze, silver, gold — standard Medallion naming' },
          { ok: true,  text: 'bronze_ecommerce, silver_crm — multi-domain separation' },
          { ok: false, text: 'Bronze, SILVER — no uppercase letters' },
          { ok: false, text: 'my schema, data-lake — no spaces or hyphens' },
        ],
      },
      {
        type: 'pitfall',
        title: 'Common Mistakes',
        items: [
          'Putting all tables in one schema → pipelines become unmanageable at scale',
          'Deleting bronze data after a pipeline error → you lose the source, rollback becomes impossible',
          'Creating too many sub-schemas early → unnecessary complexity before you need it',
        ],
      },
    ],
    insight: 'Start with just bronze and gold. Add silver only when you have 3+ pipeline transformations reading from the same source.',
  },

  {
    id: 'create-table',
    icon: '📋',
    title: 'Create Iceberg Table',
    subtitle: '3-step wizard — no SQL required',
    color: '#8b5cf6',
    actions: [{ label: 'Click "+ New Table" → Fill in all 3 wizard steps → Click Create table' }],
    sections: [
      {
        type: 'wizard',
        items: [
          {
            num: 1, title: 'Details — Table Identity',
            points: [
              'Schema: pick bronze/silver/gold based on the data tier',
              'Table Name: use snake_case, start with a letter (e.g. raw_orders)',
              'Description: 1–2 sentences so your team understands what this table holds',
            ],
          },
          {
            num: 2, title: 'Columns — Define the Schema',
            points: [
              'Always include an id (BIGINT) and created_at (TIMESTAMP) column',
              'Use VARCHAR for short strings (< 255 chars), DOUBLE for decimals',
              'BOOLEAN for status flags (is_active, is_deleted, is_paid)',
              'ARRAY for list fields like tag_ids or category_codes',
            ],
          },
          {
            num: 3, title: 'Advanced — Partition & Format',
            points: [
              'Format: always choose PARQUET (best compression, fastest queries)',
              'Partition By: use a time column to speed up time-range filters',
              'Sort By: add if you frequently filter on a specific column (e.g. user_id)',
              'Leave empty for small tables (< 1 GB) — partitioning adds overhead',
            ],
          },
        ],
      },
      {
        type: 'types',
        title: 'When to Use Each Data Type',
        items: [
          { type: 'BIGINT',    when: 'IDs, foreign keys, counters expected to exceed 2 billion' },
          { type: 'INTEGER',   when: 'Small integers: quantity, age, rank, page number' },
          { type: 'DOUBLE',    when: 'Rates, ratios, latitude/longitude, generic decimals' },
          { type: 'VARCHAR',   when: 'Names, codes, short strings — set a max length' },
          { type: 'TIMESTAMP', when: 'Event time, created_at, updated_at, logged_at' },
          { type: 'DATE',      when: 'Date-only values: birthdate, invoice_date, report_date' },
          { type: 'BOOLEAN',   when: 'Status flags: is_active, is_verified, is_deleted' },
          { type: 'ARRAY',     when: 'Lists of values: tag_ids, category_codes, permission_keys' },
        ],
      },
      {
        type: 'partition',
        title: 'Partition Strategy — Choose the Right Pattern',
        items: [
          {
            label: 'month(created_at)',
            use: 'Transaction data, logs — queried by month',
            note: 'Most common pattern. Each month becomes a separate directory.',
          },
          {
            label: 'year(event_date)',
            use: 'Multi-year historical data, rarely queried by day',
            note: 'Use when data spans 3+ years and filters are typically year-level.',
          },
          {
            label: 'bucket(16, user_id)',
            use: 'Data joined with other tables on user_id',
            note: 'Speeds up joins. Bucket count should be a power of 2 (8, 16, 32).',
          },
          {
            label: 'region, month(date)',
            use: 'Multi-region data queried by region + time range',
            note: 'Combine partitions: put the low-cardinality column first.',
          },
        ],
      },
      {
        type: 'pitfall',
        title: 'Common Mistakes',
        items: [
          'Partitioning by a high-cardinality column (user_id, order_id) → creates millions of tiny files, slower than no partition',
          'Using DOUBLE for monetary values requiring exact precision → use DECIMAL(18,2) instead',
          'No partition on tables that grow beyond 10 GB → queries will become painfully slow',
          'Using camelCase column names (userId) → Trino is case-insensitive, leads to ambiguity',
        ],
      },
    ],
    insight: 'Best practice: Create bronze tables with a minimal schema (only raw source fields). Once you understand the query patterns, create silver/gold tables with proper partitioning.',
  },

  {
    id: 'explore-table',
    icon: '🔍',
    title: 'Explore Tables',
    subtitle: 'All table details at your fingertips — no SQL',
    color: '#06b6d4',
    actions: [{ label: 'Select a table in the left tree → View details in the center panel → Switch tabs' }],
    sections: [
      {
        type: 'tabs',
        items: [
          {
            icon: '📊', name: 'Overview', color: '#06b6d4',
            desc: 'Live dashboard of table metadata and health.',
            details: [
              'Row Count: approximate total rows from Iceberg metadata (instant — no full scan)',
              'File Count: number of physical data files. If > 1000 → run Compaction',
              'Total Size: actual on-disk size in MinIO (compressed)',
              'Snapshot Count: number of write operations = total checkpoints you can time-travel to',
              'Last Updated: last write timestamp — use this to monitor whether a pipeline is running',
            ],
          },
          {
            icon: '📝', name: 'Schema', color: '#8b5cf6',
            desc: 'View and edit column structure directly — no SQL ALTER TABLE needed.',
            details: [
              'Add Column: click "+ Add Column" → does not affect existing data (Iceberg schema evolution)',
              'Rename Column: click the pencil icon → type the new name → press Enter',
              'Drop Column: click trash icon → old data stays intact in previous snapshots',
              'Type changes (VARCHAR → BIGINT) are not supported directly — create a new column instead',
            ],
          },
          {
            icon: '👁️', name: 'Preview', color: '#10b981',
            desc: 'View the first 50 rows of live data.',
            details: [
              'Data is fetched directly from Trino (always up-to-date)',
              'Click any column header to sort ascending/descending',
              'NULL values are rendered with a distinct badge for easy identification',
              'Empty table → shows "No data yet" — import data via the Import CSV tab',
            ],
          },
          {
            icon: '📷', name: 'Snapshots', color: '#f59e0b',
            desc: 'Full history of all writes — the gateway to Time Travel.',
            details: [
              'Every INSERT / IMPORT / DELETE creates a new snapshot automatically',
              'Each snapshot has: a unique ID, timestamp, and operation type (append/overwrite)',
              'Click "Preview at Snapshot" to view data exactly as it was at that point in time',
              'Snapshots are permanently removed when you run Vacuum — time travel is lost after that',
            ],
          },
          {
            icon: '💻', name: 'DDL', color: '#6366f1',
            desc: 'The SQL statement that defines this table — read-only reference.',
            details: [
              'Read-only: for reference and documentation only, cannot be edited here',
              'Copy the DDL to use as a template for creating similar tables',
              'Shows PARTITIONING strategy and physical LOCATION path in MinIO',
            ],
          },
        ],
      },
      {
        type: 'pitfall',
        title: 'Important Notes',
        items: [
          'Row Count in Overview is approximate (from metadata) — it\'s not an exact COUNT(*) result',
          'Schema Evolution (add/drop/rename columns) does not backfill old data — run a Pipeline if you need to populate a new column',
          'Preview shows only 50 rows — do not use it for aggregation or data quality checks',
        ],
      },
    ],
    insight: 'Pro tip: Monitor "File Count" in the Overview tab weekly. If it grows quickly without Compaction, query performance will degrade noticeably over time.',
  },

  {
    id: 'import-data',
    icon: '📂',
    title: 'Import CSV Data',
    subtitle: 'Upload, auto-map columns, no code needed',
    color: '#10b981',
    actions: [{ label: 'Select a table → Click "Import CSV" tab → Drag and drop your file' }],
    sections: [
      {
        type: 'steps',
        title: 'Step-by-Step Import Process',
        items: [
          {
            num: 1, title: 'Prepare Your CSV File',
            points: [
              'File MUST have a header row (first row = column names)',
              'Encoding: UTF-8 to prevent character corruption',
              'Current limit: files up to 500 MB per import',
              'Column names in the CSV are matched to table columns (case-insensitive)',
            ],
          },
          {
            num: 2, title: 'Upload and Preview',
            points: [
              'Drag and drop the file into the upload zone, or click to browse',
              'System auto-detects column mapping and infers data types',
              'Preview the first 10 rows before committing the import',
              'Columns that don\'t exist in the table are automatically skipped',
            ],
          },
          {
            num: 3, title: 'Choose Import Mode',
            points: [
              '➕ APPEND: Add new rows on top of existing data (data is preserved)',
              '🔄 OVERWRITE: Delete all existing data → replace with file contents',
              'After OVERWRITE: a new Snapshot is created → you can still time-travel back',
              'Click "Import" → wait for the progress bar → verify in the Preview tab',
            ],
          },
        ],
      },
      {
        type: 'pitfall',
        title: 'Common Errors & How to Fix Them',
        items: [
          '"Column type mismatch": CSV has a number in a TIMESTAMP column → Fix the date format in the CSV to YYYY-MM-DD HH:MM:SS',
          '"File too large": Split the file into smaller chunks and import with APPEND mode',
          'Import completes but data is not visible: Wait 5–10 seconds, then click Refresh in the Preview tab',
          'Duplicate rows after APPEND: Iceberg does not auto-deduplicate → run a dedup Pipeline on silver',
        ],
      },
      {
        type: 'concept',
        title: '⚡ Files Larger Than 500 MB — What to Do',
        body: 'Use Pipeline Studio: create a CSV Connector pointing to a file in MinIO → the Pipeline handles splitting and parallel processing automatically. No size limit.',
      },
    ],
    insight: 'OVERWRITE is safe because Iceberg takes a snapshot before deleting data. If you import a wrong file → go to the Snapshots tab → "Preview at previous snapshot" to verify → ask an admin to run a rollback.',
  },

  {
    id: 'optimize',
    icon: '⚡',
    title: 'Performance Optimization',
    subtitle: 'Compaction and Vacuum — when and why',
    color: '#ef4444',
    actions: [{ label: 'Select a table → Click "Optimize" tab → Choose operation → Click Run' }],
    sections: [
      {
        type: 'operations',
        items: [
          {
            name: '🚀 Data Compaction',
            badge: 'SAFE', badgeColor: '#10b981',
            when_to_run: 'File Count > 500, or many small files < 10 MB each',
            what_it_does: 'Merges many small files into larger blocks (~512 MB each). Queries read fewer files → significantly faster.',
            impact: 'No data loss. No disruption to readers. Can run while the table is in use.',
            expected: 'File Count drops 80–95%. Query time improves 3–10×.',
            risk: 'No risk. Data is identical before and after compaction.',
          },
          {
            name: '🧹 Vacuum Snapshots',
            badge: 'CAUTION', badgeColor: '#f59e0b',
            when_to_run: 'After confirming data is correct and you need to reclaim storage space',
            what_it_does: 'Permanently deletes snapshots older than the retention threshold (default: 7 days). Frees actual disk space in MinIO.',
            impact: 'IRREVERSIBLE. Deleted snapshots cannot be used for time travel anymore.',
            expected: 'Total size decreases significantly. Metadata becomes lighter.',
            risk: 'If you discover a data error after Vacuum → rollback to that point is no longer possible.',
          },
        ],
      },
      {
        type: 'schedule',
        title: '📅 Recommended Optimization Schedule',
        items: [
          'Daily: Not needed — Iceberg manages metadata automatically',
          'Weekly: Run Compaction if File Count > 300',
          'Monthly: Run Vacuum (after confirming data correctness and backups)',
          'After any large import: Run Compaction immediately',
        ],
      },
      {
        type: 'pitfall',
        title: 'Common Mistakes',
        items: [
          'Running Vacuum before verifying data is correct → loses the ability to rollback',
          'Not running Compaction after repeated imports → File Count grows into the thousands, queries degrade gradually',
          'Running Compaction during an active large Pipeline insert → harmless, but better to wait for the pipeline to finish',
        ],
      },
    ],
    insight: 'Golden rule: "Compact early, vacuum late." Run Compaction frequently (safe and fast). Only vacuum when storage is genuinely constrained and you are confident no rollback is needed.',
  },

  {
    id: 'time-travel',
    icon: '⏰',
    title: 'Time Travel & Rollback',
    subtitle: 'View or restore data at any point in history',
    color: '#6366f1',
    actions: [{ label: 'Select a table → Click "Snapshots" tab → Find a snapshot → Click "Preview at Snapshot"' }],
    sections: [
      {
        type: 'concept',
        title: 'How Iceberg Snapshots Work',
        body: 'Every write to a table (import, pipeline insert) creates a new snapshot — similar to a Git commit. Old snapshots are not deleted immediately, letting you "travel back in time" to any prior state.',
      },
      {
        type: 'steps',
        title: 'How to Use Time Travel',
        items: [
          {
            num: 1, title: 'Identify the Target Snapshot',
            points: [
              'Open the Snapshots tab → view all checkpoints in chronological order',
              'Each snapshot shows: ID, timestamp, and operation type (append/overwrite/delete)',
              'Find the snapshot created just BEFORE the error or bad write occurred',
            ],
          },
          {
            num: 2, title: 'Preview Data at That Snapshot',
            points: [
              'Click "Preview at Snapshot" → the Preview tab switches to that point in time',
              'Compare with current data to confirm you have the right snapshot',
              'If correct → ask an admin to run: CALL system.rollback_to_snapshot()',
            ],
          },
          {
            num: 3, title: 'After Rollback',
            points: [
              'A NEW snapshot is created representing the rollback operation',
              'Table data is restored to the state at the selected snapshot',
              'Re-trigger any pipelines from that point to re-sync downstream data',
            ],
          },
        ],
      },
      {
        type: 'use_cases',
        title: '🔧 Real-World Use Cases for Time Travel',
        items: [
          'Pipeline writes incorrect data → roll back to the state before the pipeline ran',
          'Accidentally imported a CSV into the wrong table → roll back to the empty state',
          'Compare today\'s data vs last week\'s → preview two different snapshots',
          'Compliance audit: prove what data existed at a specific point in time',
        ],
      },
      {
        type: 'pitfall',
        title: 'Limitations to Know',
        items: [
          'Cannot time-travel to before the table was created',
          'Snapshots removed by Vacuum are gone permanently — time travel to those points is lost',
          'Rollback does not automatically re-trigger pipelines — you must do this manually',
        ],
      },
    ],
    insight: 'Time travel is Iceberg\'s "insurance policy." Not every database offers this. Use it freely before running Vacuum to verify your data is in a good state.',
  },
]

// ─── Helper Components ────────────────────────────────────────────────────────
function ActionBadge({ action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 12px', borderRadius: 8, margin: '10px 0',
      background: 'rgba(139,92,246,0.08)', border: '1px dashed rgba(139,92,246,0.3)',
    }}>
      <MousePointer2 size={12} style={{ color: '#a78bfa', flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: 12, color: '#c4b5fd', lineHeight: 1.6 }}>{action.label}</span>
    </div>
  )
}

function SectionBlock({ section, stepColor }) {
  switch (section.type) {

    case 'concept':
      return (
        <div style={{ margin: '10px 0', padding: '9px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
          {section.title && <div style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', marginBottom: 5 }}>{section.title}</div>}
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>{section.body}</p>
        </div>
      )

    case 'tiers':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' }}>
          {section.items.map(t => (
            <div key={t.name} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-glass)', border: `1px solid ${t.color}33` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <span style={{ fontSize: 18, lineHeight: 1 }}>{t.emoji}</span>
                <code style={{ fontSize: 12, color: t.color, fontWeight: 700 }}>{t.name}</code>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {t.title}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 5 }}>{t.desc}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>📌 e.g. <em>{t.example}</em></div>
              <div style={{ fontSize: 10, color: '#fbbf24', padding: '2px 7px', borderRadius: 4, display: 'inline-block', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.2)' }}>
                ⚡ {t.rule}
              </div>
            </div>
          ))}
        </div>
      )

    case 'naming':
      return (
        <div style={{ margin: '10px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {section.rules.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                {r.ok ? <CheckCircle2 size={13} style={{ color: '#10b981', flexShrink: 0 }} /> : <XCircle size={13} style={{ color: '#ef4444', flexShrink: 0 }} />}
                <code style={{ color: r.ok ? '#6ee7b7' : '#fca5a5', background: r.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{r.text}</code>
              </div>
            ))}
          </div>
        </div>
      )

    case 'wizard':
      return (
        <div style={{ margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 9 }}>
          {section.items.map(w => (
            <div key={w.num} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-glass)', border: `1px solid ${stepColor}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
                <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: `${stepColor}22`, border: `1.5px solid ${stepColor}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: stepColor }}>{w.num}</div>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{w.title}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {w.points.map((p, i) => <li key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )

    case 'types':
      return (
        <div style={{ margin: '10px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {section.items.map(t => (
              <div key={t.type} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-glass)' }}>
                <code style={{ fontSize: 10, minWidth: 80, padding: '2px 5px', borderRadius: 4, textAlign: 'center', background: 'rgba(139,92,246,0.12)', color: '#a78bfa', fontWeight: 600 }}>{t.type}</code>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t.when}</span>
              </div>
            ))}
          </div>
        </div>
      )

    case 'partition':
      return (
        <div style={{ margin: '10px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {section.items.map(p => (
              <div key={p.label} style={{ padding: '8px 11px', borderRadius: 7, background: 'var(--bg-glass)', border: '1px solid var(--border)' }}>
                <code style={{ fontSize: 12, color: '#c4b5fd', fontWeight: 600 }}>{p.label}</code>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '3px 0 2px', lineHeight: 1.5 }}>📌 {p.use}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, fontStyle: 'italic' }}>💡 {p.note}</div>
              </div>
            ))}
          </div>
        </div>
      )

    case 'tabs':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' }}>
          {section.items.map(t => (
            <div key={t.name} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-glass)', border: `1px solid ${t.color}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
                <span style={{ fontSize: 16 }}>{t.icon}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: t.color }}>{t.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— {t.desc}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {t.details.map((d, i) => <li key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{d}</li>)}
              </ul>
            </div>
          ))}
        </div>
      )

    case 'operations':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '10px 0' }}>
          {section.items.map(op => (
            <div key={op.name} style={{ padding: '11px 13px', borderRadius: 9, background: 'var(--bg-glass)', border: `1px solid ${op.badgeColor === '#10b981' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.25)'}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{op.name}</span>
                <span style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, fontWeight: 700, background: `${op.badgeColor}18`, color: op.badgeColor, border: `1px solid ${op.badgeColor}33` }}>{op.badge}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {[
                  { label: 'When to run', value: op.when_to_run, color: 'var(--text-secondary)' },
                  { label: 'What it does', value: op.what_it_does, color: 'var(--text-secondary)' },
                  { label: 'Expected result', value: op.expected, color: '#6ee7b7' },
                ].map(row => (
                  <div key={row.label} style={{ fontSize: 11, lineHeight: 1.6 }}>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{row.label}: </span>
                    <span style={{ color: row.color }}>{row.value}</span>
                  </div>
                ))}
                <div style={{ marginTop: 2, padding: '5px 9px', borderRadius: 6, fontSize: 11, lineHeight: 1.5, background: op.badgeColor === '#10b981' ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.08)', color: op.badgeColor, border: `1px solid ${op.badgeColor}22` }}>
                  ⚠️ {op.risk}
                </div>
              </div>
            </div>
          ))}
        </div>
      )

    case 'schedule':
      return (
        <div style={{ margin: '10px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {section.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-glass)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <span style={{ color: '#8b5cf6', flexShrink: 0 }}>•</span>{item}
              </div>
            ))}
          </div>
        </div>
      )

    case 'steps':
      return (
        <div style={{ margin: '10px 0' }}>
          {section.title && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {section.items.map(s => (
              <div key={s.num} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-glass)', border: `1px solid ${stepColor}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, background: `${stepColor}22`, border: `1.5px solid ${stepColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: stepColor }}>{s.num}</div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{s.title}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {s.points.map((p, i) => <li key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{p}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )

    case 'use_cases':
      return (
        <div style={{ margin: '10px 0' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {section.items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.12)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <span style={{ color: '#6366f1', flexShrink: 0 }}>▸</span>{item}
              </div>
            ))}
          </div>
        </div>
      )

    case 'pitfall':
      return (
        <div style={{ margin: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
            <AlertTriangle size={12} style={{ color: '#f59e0b' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{section.title}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {section.items.map((item, i) => (
              <div key={i} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, lineHeight: 1.6, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', color: 'var(--text-secondary)', display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                <span style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }}>!</span>{item}
              </div>
            ))}
          </div>
        </div>
      )

    default: return null
  }
}

// ─── Step Card ────────────────────────────────────────────────────────────────
function StepCard({ step, index, isActive, isDone, isHighlighted, onToggleDone, onExpand, stepRef }) {
  return (
    <div ref={stepRef} style={{
      borderRadius: 10, overflow: 'hidden', marginBottom: 8,
      border: isHighlighted ? `1.5px solid ${step.color}99` : `1px solid ${isActive ? step.color + '44' : 'var(--border)'}`,
      transition: 'all 0.25s ease',
      background: isHighlighted ? `${step.color}10` : isActive ? `${step.color}06` : 'var(--bg-surface)',
      boxShadow: isHighlighted ? `0 0 0 2px ${step.color}33` : 'none',
    }}>
      <div onClick={onExpand} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', userSelect: 'none' }}>
        <div onClick={e => { e.stopPropagation(); onToggleDone() }} title={isDone ? 'Unmark' : 'Mark as read'} style={{
          width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isDone ? '#10b981' : `${step.color}22`,
          border: `1.5px solid ${isDone ? '#10b981' : step.color + '66'}`,
          cursor: 'pointer', transition: 'all 0.2s',
          fontSize: 11, fontWeight: 700, color: isDone ? '#fff' : step.color,
        }}>
          {isDone ? <CheckCircle2 size={13} /> : index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>{step.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: isDone ? 'var(--text-muted)' : 'var(--text)', textDecoration: isDone ? 'line-through' : 'none' }}>{step.title}</span>
            {isHighlighted && !isDone && (
              <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 10, fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', animation: 'pulse 1.5s infinite' }}>ERROR</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{step.subtitle}</div>
        </div>
        <ChevronRight size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, transform: isActive ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
      </div>

      {isActive && (
        <div style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--border)' }}>
          {step.actions?.map((a, i) => <ActionBadge key={i} action={a} />)}
          {step.sections?.map((section, i) => <SectionBlock key={i} section={section} stepColor={step.color} />)}
          {step.insight && (
            <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Sparkles size={12} style={{ color: '#6366f1', flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7, fontStyle: 'italic' }}>{step.insight}</span>
            </div>
          )}
          <button onClick={onToggleDone} style={{
            marginTop: 12, width: '100%', padding: '8px', borderRadius: 8, cursor: 'pointer',
            fontSize: 12, fontWeight: 600, transition: 'all 0.2s',
            background: isDone ? 'rgba(16,185,129,0.1)' : `${step.color}18`,
            border: `1px solid ${isDone ? 'rgba(16,185,129,0.3)' : step.color + '44'}`,
            color: isDone ? '#10b981' : step.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {isDone ? <><CheckCircle2 size={13} /> Unmark</> : <><Circle size={13} /> Mark as read ✓</>}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Drawer ──────────────────────────────────────────────────────────────
export default function DocGuideDrawer({ schema, table }) {
  const { closeDrawer, pendingHighlight, clearPendingHighlight, resetErrorStreak } = useDocStore()
  const [activeStep, setActiveStep]         = useState(null)
  const [doneSteps, setDoneSteps]           = useState({})
  const [currentHighlight, setCurrentHighlight] = useState(null)
  const stepRefs = useRef({})

  useEffect(() => {
    if (!pendingHighlight) return
    const stepId = pendingHighlight
    setCurrentHighlight(stepId)
    const idx = GUIDE_STEPS.findIndex(s => s.id === stepId)
    if (idx >= 0) {
      setActiveStep(idx)
      setTimeout(() => stepRefs.current[stepId]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
    }
    clearPendingHighlight()
    setTimeout(() => setCurrentHighlight(null), 8000)
  }, [pendingHighlight])

  const doneCount   = Object.values(doneSteps).filter(Boolean).length
  const progressPct = Math.round((doneCount / GUIDE_STEPS.length) * 100)

  function toggleDone(id) {
    const willBeDone = !doneSteps[id]
    setDoneSteps(p => ({ ...p, [id]: willBeDone }))
    if (willBeDone) resetErrorStreak()
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>

      {/* Header */}
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-glass)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3 }}>
              <BookOpen size={14} style={{ color: 'var(--primary)' }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>User Guide</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Data Model · {GUIDE_STEPS.length} topics</div>
          </div>
          <button onClick={closeDrawer} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', borderRadius: 5, padding: '3px 6px', display: 'flex' }}>
            <X size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, background: progressPct === 100 ? 'linear-gradient(90deg, #10b981, #06b6d4)' : 'linear-gradient(90deg, #8b5cf6, #6366f1)', borderRadius: 3, transition: 'width 0.5s ease' }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{doneCount}/{GUIDE_STEPS.length} read</span>
        </div>
        {progressPct === 100 && (
          <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 7, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', fontSize: 11, color: '#10b981', textAlign: 'center', fontWeight: 600 }}>
            🎉 You've mastered the Data Model!
          </div>
        )}
      </div>

      {/* Context chip */}
      {schema && table && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(99,102,241,0.05)', flexShrink: 0 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#8b5cf6', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Viewing:</span>
          <code style={{ fontSize: 11, color: 'var(--primary)' }}>{schema}.{table}</code>
        </div>
      )}

      {/* Steps */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', scrollbarWidth: 'thin', scrollbarColor: 'var(--border) transparent' }}>
        {GUIDE_STEPS.map((step, i) => (
          <StepCard
            key={step.id} step={step} index={i}
            isActive={activeStep === i} isDone={!!doneSteps[step.id]}
            isHighlighted={currentHighlight === step.id}
            onToggleDone={() => toggleDone(step.id)}
            onExpand={() => setActiveStep(prev => prev === i ? null : i)}
            stepRef={el => { stepRefs.current[step.id] = el }}
          />
        ))}
      </div>

      {/* Footer */}
      <div style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <MousePointer2 size={11} /> Click a topic to expand the guide
        </span>
        {doneCount > 0 && doneCount < GUIDE_STEPS.length && (
          <span style={{ color: '#8b5cf6' }}>{GUIDE_STEPS.length - doneCount} remaining</span>
        )}
      </div>
    </div>
  )
}

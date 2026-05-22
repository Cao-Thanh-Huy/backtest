'use client'

import { useState } from 'react'
import {
  Bitcoin, Database, Activity, Target, Brain, TrendingUp,
  AlertTriangle, ArrowRight, AlertCircle, Shield,
} from 'lucide-react'

const PHASE_META = [
  {
    id: 0, label: 'Data Infrastructure', short: 'Data',
    Icon: Database, accent: '#06B6D4',
    text: '#67E8F9', dim: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.22)',
    badgeBg: 'rgba(6,182,212,0.14)', badgeBorder: 'rgba(6,182,212,0.30)',
  },
  {
    id: 1, label: 'Feature Engineering', short: 'Features',
    Icon: Activity, accent: '#14B8A6',
    text: '#5EEAD4', dim: 'rgba(20,184,166,0.06)', border: 'rgba(20,184,166,0.22)',
    badgeBg: 'rgba(20,184,166,0.14)', badgeBorder: 'rgba(20,184,166,0.30)',
  },
  {
    id: 2, label: 'Labeling & Dataset', short: 'Labeling',
    Icon: Target, accent: '#8B5CF6',
    text: '#C4B5FD', dim: 'rgba(139,92,246,0.06)', border: 'rgba(139,92,246,0.22)',
    badgeBg: 'rgba(139,92,246,0.14)', badgeBorder: 'rgba(139,92,246,0.30)',
  },
  {
    id: 3, label: 'Modeling', short: 'Models',
    Icon: Brain, accent: '#A78BFA',
    text: '#DDD6FE', dim: 'rgba(167,139,250,0.06)', border: 'rgba(167,139,250,0.22)',
    badgeBg: 'rgba(167,139,250,0.14)', badgeBorder: 'rgba(167,139,250,0.30)',
  },
  {
    id: 4, label: 'Evaluation & Deploy', short: 'Eval',
    Icon: TrendingUp, accent: '#22C55E',
    text: '#86EFAC', dim: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.22)',
    badgeBg: 'rgba(34,197,94,0.14)', badgeBorder: 'rgba(34,197,94,0.30)',
  },
]

type Stage = {
  id: number; phase: number; stage: string; goal: string
  tasks: string; io: string; tools: string[]; gotcha: string
}

const STAGES: Stage[] = [
  { id: 0, phase: 0, stage: 'Strategy Definition', goal: 'Xác định bài toán',
    tasks: 'Chọn market, timeframe, holding time, leverage, execution style',
    io: 'Idea → Research Plan', tools: ['Jupyter', 'Notion'],
    gotcha: 'Không define rõ từ đầu → model học sai objective' },
  { id: 1, phase: 0, stage: 'Raw Data Collection', goal: 'Thu thập dữ liệu thô',
    tasks: 'OHLCV, Funding, OI, Liquidation, Orderbook, On-chain, Macro',
    io: 'APIs → Raw tables', tools: ['ccxt', 'CoinGlass', 'Glassnode'],
    gotcha: 'BTC 24/7 nhưng macro assets không chạy liên tục' },
  { id: 2, phase: 0, stage: 'Storage Layer', goal: 'Lưu dữ liệu chuẩn',
    tasks: 'Parquet files, partition theo timeframe/date',
    io: 'Raw API → Structured files', tools: ['Parquet', 'DuckDB'],
    gotcha: 'CSV lớn sẽ rất chậm và khó scale' },
  { id: 3, phase: 0, stage: 'Timestamp Alignment', goal: 'Đồng bộ timeline',
    tasks: 'Convert UTC, resample candles, merge multi-source',
    io: 'Multi-source → Unified timeline', tools: ['pandas.resample()'],
    gotcha: 'Dễ bị look-ahead bias khi merge Daily vào intraday' },
  { id: 4, phase: 0, stage: 'Data Cleaning', goal: 'Làm sạch dữ liệu',
    tasks: 'Remove duplicates, gap detection, abnormal spike removal',
    io: 'Dirty data → Clean data', tools: ['pandas', 'numpy'],
    gotcha: 'Không xóa volatility spikes thật của BTC' },
  { id: 5, phase: 0, stage: 'Missing Value Handling', goal: 'Xử lý missing',
    tasks: 'Forward-fill, interpolation, drop invalid rows',
    io: 'Incomplete → Complete dataset', tools: ['pandas.fillna()'],
    gotcha: 'Không forward-fill future information' },
  { id: 6, phase: 0, stage: 'Scaling & Normalization', goal: 'Chuẩn hóa feature',
    tasks: 'StandardScaler, MinMax, Robust scaling',
    io: 'Raw feature → Normalized', tools: ['scikit-learn'],
    gotcha: 'Chỉ fit scaler trên train set' },
  { id: 7, phase: 1, stage: 'Regime Detection', goal: 'Xác định trạng thái market',
    tasks: 'Bull/Bear, trend strength, volatility regime',
    io: 'Price history → Regime labels', tools: ['ATR', 'realized vol'],
    gotcha: 'BTC non-stationary cực mạnh' },
  { id: 8, phase: 1, stage: 'Technical Features', goal: 'Tạo feature kỹ thuật',
    tasks: 'RSI, MACD, EMA slope, ATR, VWAP, BBands',
    io: 'OHLCV → Indicators', tools: ['TA-Lib', 'pandas-ta'],
    gotcha: 'Quá nhiều indicators → noise & overfit' },
  { id: 9, phase: 1, stage: 'Statistical Features', goal: 'Feature thống kê',
    tasks: 'Returns, rolling std, skewness, kurtosis',
    io: 'Price → Statistical features', tools: ['numpy', 'scipy'],
    gotcha: 'Volatility clustering rất quan trọng' },
  { id: 10, phase: 1, stage: 'Futures Features', goal: 'Futures market alpha',
    tasks: 'Funding divergence, OI spikes, basis spread',
    io: 'Futures data → Flow signals', tools: ['CoinGlass APIs'],
    gotcha: 'Futures data thường alpha mạnh hơn indicators' },
  { id: 11, phase: 1, stage: 'Orderflow Features', goal: 'Microstructure signals',
    tasks: 'Bid/ask imbalance, delta, CVD, absorption',
    io: 'Orderbook → Pressure metrics', tools: ['WebSocket feeds'],
    gotcha: 'Hữu ích mạnh ở low timeframe' },
  { id: 12, phase: 1, stage: 'On-chain Features', goal: 'Blockchain flow',
    tasks: 'SOPR, MVRV, exchange inflow/outflow',
    io: 'On-chain → Investor behavior', tools: ['Glassnode'],
    gotcha: 'Hợp swing hơn scalp' },
  { id: 13, phase: 1, stage: 'Sentiment Features', goal: 'Market psychology',
    tasks: 'Twitter sentiment, Fear & Greed, news scoring',
    io: 'Text/news → Sentiment score', tools: ['VADER', 'FinBERT'],
    gotcha: 'Tin macro có thể phá mọi setup kỹ thuật' },
  { id: 14, phase: 1, stage: 'Multi-Timeframe Features', goal: 'Kết hợp nhiều TF',
    tasks: 'Daily trend + 1H setup + 5m execution',
    io: 'Multi TF → Context-aware features', tools: ['pandas merge'],
    gotcha: 'Dễ leakage nếu merge sai timestamp' },
  { id: 15, phase: 1, stage: 'Feature Selection', goal: 'Chọn feature mạnh',
    tasks: 'Correlation filter, SHAP importance, MI score',
    io: 'Large feature set → Best features', tools: ['sklearn', 'SHAP'],
    gotcha: 'Nhiều feature ≠ tốt hơn' },
  { id: 16, phase: 1, stage: 'Feature Stability Check', goal: 'Kiểm tra độ ổn định',
    tasks: 'Compare feature importance qua nhiều time periods',
    io: 'Feature importances → Stable subset', tools: ['SHAP', 'LightGBM'],
    gotcha: 'Feature drift là vấn đề lớn' },
  { id: 17, phase: 2, stage: 'Labeling', goal: 'Tạo target prediction',
    tasks: 'Direction label, future return, triple barrier',
    io: 'Features → Labels', tools: ['pandas.shift()'],
    gotcha: 'Labeling sai = model hoàn toàn vô dụng' },
  { id: 18, phase: 2, stage: 'Triple Barrier Labeling', goal: 'Label thực chiến',
    tasks: 'TP hit / SL hit / timeout label',
    io: 'Future movement → Trade outcome', tools: ['Custom logic'],
    gotcha: 'Tốt hơn next-candle prediction đơn giản' },
  { id: 19, phase: 2, stage: 'Windowing / Sequence', goal: 'Tạo sequence input',
    tasks: 'Rolling windows cho LSTM/GRU input',
    io: 'Tabular → Sequential tensors', tools: ['numpy', 'PyTorch'],
    gotcha: 'Sai sequence order = leakage nghiêm trọng' },
  { id: 20, phase: 2, stage: 'Train / Val / Test Split', goal: 'Chia dataset chuẩn',
    tasks: 'Walk-forward split, rolling window approach',
    io: 'Full dataset → Split sets', tools: ['TimeSeriesSplit'],
    gotcha: 'Không shuffle time-series' },
  { id: 21, phase: 2, stage: 'Purged Cross-Validation', goal: 'Chống leakage nâng cao',
    tasks: 'Remove overlapping labels giữa các folds',
    io: 'Sequential data → Safe folds', tools: ['Custom CV'],
    gotcha: 'Hedge funds dùng technique này rất nhiều' },
  { id: 22, phase: 3, stage: 'Baseline Model', goal: 'Benchmark đơn giản',
    tasks: 'Logistic Regression, Random Forest đơn giản',
    io: 'Features → Baseline score', tools: ['sklearn'],
    gotcha: 'Luôn cần baseline để đối chiếu' },
  { id: 23, phase: 3, stage: 'Main Modeling', goal: 'Train model chính',
    tasks: 'XGBoost, LightGBM, CatBoost, LSTM',
    io: 'Dataset → Trained model', tools: ['LightGBM', 'PyTorch'],
    gotcha: 'Tree models thường mạnh hơn DL trên tabular BTC' },
  { id: 24, phase: 3, stage: 'Hyperparameter Tuning', goal: 'Tối ưu model',
    tasks: 'Bayesian tuning, Optuna search space',
    io: 'Raw params → Optimal params', tools: ['Optuna'],
    gotcha: 'Over-tuning chỉ fit historical data' },
  { id: 25, phase: 3, stage: 'Overfitting Control', goal: 'Giảm overfit',
    tasks: 'Dropout, early stopping, L2 regularization, pruning',
    io: 'Complex model → Robust model', tools: ['PyTorch'],
    gotcha: 'Train score quá đẹp là red flag rõ ràng' },
  { id: 26, phase: 3, stage: 'Probability Calibration', goal: 'Chuẩn hóa confidence',
    tasks: 'Platt scaling, isotonic regression',
    io: 'Raw probability → Calibrated prob', tools: ['sklearn'],
    gotcha: 'Quant cần confidence scores đáng tin' },
  { id: 27, phase: 3, stage: 'Ensemble Modeling', goal: 'Kết hợp nhiều model',
    tasks: 'Blend trend + flow + volatility model outputs',
    io: 'Multiple models → Ensemble signal', tools: ['Weighted ensemble'],
    gotcha: 'Ensemble ổn định hơn single model' },
  { id: 28, phase: 4, stage: 'Backtesting Engine', goal: 'Simulate trading',
    tasks: 'Entries, exits, TP/SL, leverage, fee modeling',
    io: 'Predictions → PnL simulation', tools: ['VectorBT', 'Backtrader'],
    gotcha: 'Không có fee/slippage = fake profitability' },
  { id: 29, phase: 4, stage: 'Slippage Modeling', goal: 'Mô phỏng execution thật',
    tasks: 'Spread, latency, partial fill simulation',
    io: 'Perfect fill → Realistic fill', tools: ['Custom simulator'],
    gotcha: 'Scalping cực nhạy cảm với slippage' },
  { id: 30, phase: 4, stage: 'Position Sizing', goal: 'Quản trị vốn',
    tasks: 'Risk % per trade, ATR sizing, volatility scaling',
    io: 'Signal → Position size', tools: ['Custom logic'],
    gotcha: 'Risk management quan trọng hơn accuracy' },
  { id: 31, phase: 4, stage: 'Performance Metrics', goal: 'Đánh giá strategy',
    tasks: 'Sharpe, Sortino, MDD, Profit Factor, Expectancy',
    io: 'Backtest results → Metric suite', tools: ['quantstats'],
    gotcha: 'Accuracy không phải metric quan trọng nhất' },
  { id: 32, phase: 4, stage: 'Robustness Testing', goal: 'Kiểm tra độ bền',
    tasks: 'Different years, regimes, noise injection tests',
    io: 'Model → Stability report', tools: ['Custom tests'],
    gotcha: 'Strategy chỉ win 1 regime sẽ collapse' },
  { id: 33, phase: 4, stage: 'Walk-forward Validation', goal: 'Simulate production',
    tasks: 'Retrain periodically, test trên unseen future',
    io: 'Historical data → Production simulation', tools: ['Rolling pipeline'],
    gotcha: 'Quan trọng hơn backtest thông thường' },
  { id: 34, phase: 4, stage: 'Feature Drift Monitoring', goal: 'Detect market change',
    tasks: 'Distribution shift detection, concept drift alerts',
    io: 'Live data → Drift alerts', tools: ['EvidentlyAI'],
    gotcha: 'BTC drift liên tục theo regime' },
  { id: 35, phase: 4, stage: 'Retraining Pipeline', goal: 'Update model định kỳ',
    tasks: 'Daily/weekly scheduled retrain on new data',
    io: 'New data → Updated model', tools: ['MLflow'],
    gotcha: 'Old models decay rất nhanh trên BTC' },
  { id: 36, phase: 4, stage: 'Final Signal Layer', goal: 'Tạo tín hiệu trade',
    tasks: 'Probability threshold filter, confidence gating',
    io: 'Prediction → Final signal', tools: ['Custom logic'],
    gotcha: 'Không phải signal nào cũng nên trade' },
  { id: 37, phase: 4, stage: 'Risk Layer', goal: 'Bảo vệ tài khoản',
    tasks: 'Daily drawdown limit, kill-switch logic',
    io: 'Trade signals → Protected execution', tools: ['Custom logic'],
    gotcha: 'Đây là thứ giữ tài khoản còn sống' },
  { id: 38, phase: 4, stage: 'Final Evaluation', goal: 'Đánh giá tổng thể',
    tasks: 'Out-of-sample performance, live paper simulation',
    io: 'Strategy → Deploy decision', tools: ['Full pipeline'],
    gotcha: 'Backtest đẹp chưa chắc live được' },
]

const DATA_LENGTH = [
  { strategy: 'Scalping', tf: '1m – 5m', data: '3 – 12 tháng', pct: 15 },
  { strategy: 'Intraday', tf: '5m – 1H', data: '1 – 2 năm', pct: 30 },
  { strategy: 'Swing', tf: '4H – 1D', data: '2 – 4 năm', pct: 60 },
  { strategy: 'Macro Cycle', tf: 'Daily – Weekly', data: '4 – 8 năm', pct: 100 },
]

const SPLITS = [
  { set: 'Train', role: 'Học pattern', pct: 65, color: '#6366F1' },
  { set: 'Validation', role: 'Tune model', pct: 17, color: '#F59E0B' },
  { set: 'Test', role: 'Final evaluation', pct: 18, color: '#22C55E' },
]

const WALK_FORWARD = [
  { train: '2023 Q1 – Q2', val: '2023 Q3', test: '2023 Q4' },
  { train: '2023 Q2 – Q3', val: '2023 Q4', test: '2024 Q1' },
  { train: '2023 Q3 – Q4', val: '2024 Q1', test: '2024 Q2' },
]

const DEADLY_ERRORS = [
  { error: 'Look-ahead bias', impact: 'Backtest ảo, không bao giờ profitable thực tế' },
  { error: 'Random shuffle time-series', impact: 'Data leakage cực nặng, model biết tương lai' },
  { error: 'Không tính fee / slippage', impact: 'Fake profitability, chết ngay khi live' },
  { error: 'Overfitting indicators', impact: 'Collapse ngay khi market thay đổi nhẹ' },
  { error: 'Train data quá cũ', impact: 'Model không match regime hiện tại' },
  { error: 'Too many features', impact: 'Noise > signal, model học nhiễu' },
  { error: 'Chỉ nhìn accuracy', impact: 'Đánh giá sai, accuracy 55% có thể lỗ tiền' },
  { error: 'Không detect regime', impact: 'Strategy collapse hoàn toàn khi market đổi phase' },
]

const PRIORITY = [
  { label: 'Data quality', score: 10, barColor: '#EF4444' },
  { label: 'Leakage prevention', score: 10, barColor: '#EF4444' },
  { label: 'Feature engineering', score: 9, barColor: '#F59E0B' },
  { label: 'Validation đúng', score: 9, barColor: '#F59E0B' },
  { label: 'Risk management', score: 9, barColor: '#F59E0B' },
  { label: 'Regime detection', score: 8, barColor: '#EAB308' },
  { label: 'Position sizing', score: 8, barColor: '#EAB308' },
  { label: 'Model choice', score: 5, barColor: '#6B7280' },
  { label: 'Fancy deep learning', score: 2, barColor: '#374151' },
]

const FLOW_STEPS = [
  { step: 'Raw Data Collection', phase: 0 },
  { step: 'Storage & Synchronization', phase: 0 },
  { step: 'Cleaning & Scaling', phase: 0 },
  { step: 'Feature Engineering', phase: 1 },
  { step: 'Feature Selection', phase: 1 },
  { step: 'Labeling', phase: 2 },
  { step: 'Train / Val / Test Split', phase: 2 },
  { step: 'Model Training', phase: 3 },
  { step: 'Hyperparameter Tuning', phase: 3 },
  { step: 'Overfitting Control', phase: 3 },
  { step: 'Backtesting', phase: 4 },
  { step: 'Walk-forward Validation', phase: 4 },
  { step: 'Robustness Testing', phase: 4 },
  { step: 'Risk Management', phase: 4 },
  { step: 'Final Trading Signal', phase: 4 },
]

function IOArrow({ io, accentColor }: { io: string; accentColor: string }) {
  const [from, to] = io.split('→').map(s => s.trim())
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] flex-wrap leading-tight">
      <span className="text-zinc-500">{from}</span>
      {to && (
        <>
          <ArrowRight className="w-2.5 h-2.5 text-zinc-600 shrink-0" />
          <span style={{ color: accentColor }}>{to}</span>
        </>
      )}
    </span>
  )
}

function ToolPill({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center px-[7px] py-[3px] rounded-[5px] text-[10px] font-mono bg-white/[0.045] border border-white/[0.08] text-zinc-400 leading-none whitespace-nowrap">
      {name}
    </span>
  )
}

function StageRow({ s }: { s: Stage }) {
  const p = PHASE_META[s.phase]
  return (
    <div
      className="flex group hover:bg-white/[0.025] transition-colors duration-100 cursor-default"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.035)' }}
    >
      <div className="w-[3px] shrink-0" style={{ background: `${p.accent}55` }} />
      <div
        className="flex-1 grid items-start gap-x-3 gap-y-1 px-4 py-3 text-xs"
        style={{ gridTemplateColumns: '38px 168px 1fr 164px 148px 1fr' }}
      >
        <div
          className="w-[34px] h-[26px] rounded-[7px] flex items-center justify-center text-[11px] font-bold font-mono shrink-0 mt-0.5"
          style={{ background: p.badgeBg, color: p.text, border: `1px solid ${p.badgeBorder}` }}
        >
          {s.id}
        </div>
        <div className="min-w-0 pt-0.5">
          <div className="text-[13px] font-semibold text-zinc-100 leading-snug">{s.stage}</div>
          <div className="text-[11px] text-zinc-500 mt-[3px] leading-snug">{s.goal}</div>
        </div>
        <div className="text-zinc-400 leading-relaxed text-[11px] pt-0.5">{s.tasks}</div>
        <div className="pt-0.5">
          <IOArrow io={s.io} accentColor={p.text} />
        </div>
        <div className="flex flex-wrap gap-[5px] pt-0.5">
          {s.tools.map(t => <ToolPill key={t} name={t} />)}
        </div>
        <div className="flex items-start gap-1.5 pt-0.5">
          <AlertTriangle className="w-[11px] h-[11px] mt-[2px] shrink-0 text-amber-400/70" />
          <span className="text-amber-200/75 leading-relaxed text-[11px]">{s.gotcha}</span>
        </div>
      </div>
    </div>
  )
}

function PhaseSection({ phaseId, stages }: { phaseId: number; stages: Stage[] }) {
  const p = PHASE_META[phaseId]
  const Icon = p.Icon
  return (
    <div className="rounded-[14px] overflow-hidden" style={{ border: `1px solid ${p.border}` }}>
      <div
        className="flex items-center gap-3 px-5 py-3"
        style={{
          background: `linear-gradient(135deg, ${p.dim} 0%, rgba(0,0,0,0) 100%)`,
          borderBottom: `1px solid ${p.border}`,
          borderTop: `2px solid ${p.accent}50`,
        }}
      >
        <div
          className="w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0"
          style={{ background: p.badgeBg, border: `1px solid ${p.badgeBorder}` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: p.text }} />
        </div>
        <span className="text-sm font-semibold" style={{ color: p.text }}>{p.label}</span>
        <span
          className="text-[10px] px-2 py-[3px] rounded-full font-medium ml-1"
          style={{ background: p.badgeBg, color: p.text, border: `1px solid ${p.badgeBorder}` }}
        >
          {stages.length} stages
        </span>
        <span className="text-[10px] text-zinc-600 ml-auto font-mono">
          #{stages[0].id} – #{stages[stages.length - 1].id}
        </span>
      </div>
      <div
        className="grid items-center gap-x-3 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-600"
        style={{ gridTemplateColumns: '38px 168px 1fr 164px 148px 1fr', background: 'rgba(255,255,255,0.015)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div>#</div>
        <div>Stage</div>
        <div>Tasks</div>
        <div>Input → Output</div>
        <div>Tools</div>
        <div>⚠ Gotcha</div>
      </div>
      <div style={{ background: 'linear-gradient(180deg, #0B1018 0%, #080D14 100%)' }}>
        {stages.map(s => <StageRow key={s.id} s={s} />)}
      </div>
    </div>
  )
}

export default function BTCOverviewPage() {
  const [activePhase, setActivePhase] = useState<number | null>(null)
  const phaseCounts = PHASE_META.map(p => STAGES.filter(s => s.phase === p.id).length)
  const visiblePhases = activePhase !== null ? [activePhase] : PHASE_META.map(p => p.id)

  return (
    <div className="min-h-screen bg-surface">

      {/* Hero */}
      <div
        className="relative px-8 py-8 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0C1221 0%, #08101C 60%, #07090F 100%)' }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse 60% 60% at 10% 50%, rgba(245,158,11,0.04) 0%, transparent 70%)'
        }} />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between max-w-7xl mx-auto">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.08] text-amber-300 text-[11px] font-bold tracking-widest uppercase mb-4">
              <Bitcoin className="w-3.5 h-3.5" />
              End-to-End Trading Playbook
            </div>
            <h1 className="text-3xl font-bold text-zinc-50 leading-tight">
              Quant Trading
              <span className="text-amber-400"> Pipeline Overview</span>
            </h1>
            <p className="text-sm text-zinc-400 mt-3 max-w-2xl leading-relaxed">
              Full workflow từ data đến model và backtest — 39 giai đoạn với input/output rõ ràng,
              tools phổ biến, và các best practices để tránh leakage, overfit, và fake profitability.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              {PHASE_META.map(p => {
                const Icon = p.Icon
                return (
                  <div key={p.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium"
                    style={{ background: p.badgeBg, color: p.text, border: `1px solid ${p.badgeBorder}` }}>
                    <Icon className="w-3 h-3" />
                    {p.short}
                    <span className="opacity-60">{phaseCounts[p.id]}</span>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 shrink-0">
            {[
              { label: 'Total Stages', value: '39', sub: 'full pipeline', color: '#06B6D4' },
              { label: 'Core Risk', value: 'Leakage', sub: '#1 deadly error', color: '#EF4444' },
              { label: 'Validation', value: 'Walk-fwd', sub: 'over k-fold', color: '#8B5CF6' },
              { label: 'Tree vs DL', value: 'LGBM', sub: 'wins on BTC tabular', color: '#22C55E' },
            ].map(k => (
              <div key={k.label}
                className="rounded-[12px] px-4 py-3 border"
                style={{ background: `${k.color}10`, borderColor: `${k.color}25` }}>
                <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: k.color }}>{k.label}</div>
                <div className="text-[17px] font-bold text-zinc-100 mt-1 leading-none">{k.value}</div>
                <div className="text-[10px] text-zinc-500 mt-1">{k.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phase filter */}
      <div className="px-8 pt-5 pb-0 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActivePhase(null)}
            className="px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all duration-150"
            style={activePhase === null
              ? { background: 'rgba(255,255,255,0.10)', color: '#E4E4E7', border: '1px solid rgba(255,255,255,0.15)' }
              : { background: 'transparent', color: '#52525B', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            All Stages
            <span className="ml-1.5 text-[10px] opacity-60">39</span>
          </button>
          {PHASE_META.map(p => {
            const Icon = p.Icon
            const active = activePhase === p.id
            return (
              <button
                key={p.id}
                onClick={() => setActivePhase(active ? null : p.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-all duration-150"
                style={active
                  ? { background: p.badgeBg, color: p.text, border: `1px solid ${p.badgeBorder}` }
                  : { background: 'transparent', color: '#52525B', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <Icon className="w-3 h-3" />
                {p.short}
                <span className="text-[10px] opacity-60">{phaseCounts[p.id]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Workflow */}
      <div className="px-8 pt-5 pb-6 max-w-7xl mx-auto space-y-4">
        <div className="overflow-x-auto">
          <div className="min-w-[1060px] space-y-3">
            {visiblePhases.map(phaseId => {
              const stages = STAGES.filter(s => s.phase === phaseId)
              return <PhaseSection key={phaseId} phaseId={phaseId} stages={stages} />
            })}
          </div>
        </div>
      </div>

      {/* Reference sections */}
      <div className="px-8 pb-8 max-w-7xl mx-auto">
        <div className="section-label mb-4">Reference Tables</div>
        <div className="grid gap-5 lg:grid-cols-3">

          {/* Col 1 */}
          <div className="space-y-5">
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06]" style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.06) 0%, transparent 100%)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  <span className="text-xs font-semibold text-zinc-200">Data Length per Strategy</span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                {DATA_LENGTH.map((r, i) => (
                  <div key={r.strategy} className="space-y-1.5">
                    <div className="flex justify-between items-baseline">
                      <span className="text-xs font-medium text-zinc-200">{r.strategy}</span>
                      <span className="text-[10px] text-cyan-300 font-mono">{r.data}</span>
                    </div>
                    <div className="h-1 rounded-full bg-white/[0.06]">
                      <div className="h-1 rounded-full" style={{
                        width: `${r.pct}%`,
                        background: ['#06B6D4','#14B8A6','#8B5CF6','#22C55E'][i]
                      }} />
                    </div>
                    <div className="text-[10px] text-zinc-500">{r.tf}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06]" style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, transparent 100%)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                  <span className="text-xs font-semibold text-zinc-200">Dataset Split Ratios</span>
                </div>
              </div>
              <div className="p-4 space-y-1">
                <div className="flex h-5 rounded-lg overflow-hidden gap-px mb-4">
                  {SPLITS.map(s => (
                    <div key={s.set} style={{ width: `${s.pct}%`, background: s.color + 'CC' }} />
                  ))}
                </div>
                {SPLITS.map(s => (
                  <div key={s.set} className="flex items-center gap-3 py-1.5 border-b border-white/[0.04] last:border-0">
                    <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
                    <span className="text-xs font-medium text-zinc-200 w-20">{s.set}</span>
                    <span className="text-[11px] text-zinc-400 flex-1">{s.role}</span>
                    <span className="text-xs font-mono font-bold" style={{ color: s.color }}>{s.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Col 2 */}
          <div className="space-y-5">
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06]" style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.06) 0%, transparent 100%)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  <span className="text-xs font-semibold text-zinc-200">Walk-forward Examples</span>
                </div>
              </div>
              <div className="p-4">
                <div className="rounded-[10px] overflow-hidden border border-white/[0.06]">
                  <div className="grid grid-cols-3 gap-px text-[10px] font-semibold uppercase tracking-wider text-zinc-600"
                    style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {['Train', 'Validation', 'Test'].map(h => (
                      <div key={h} className="px-3 py-2" style={{ background: '#0B1018' }}>{h}</div>
                    ))}
                  </div>
                  {WALK_FORWARD.map((r, i) => (
                    <div key={i} className="grid grid-cols-3 gap-px text-[11px]"
                      style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="px-3 py-2.5 text-indigo-300/80 font-mono" style={{ background: i % 2 === 0 ? '#090E16' : '#07090F' }}>{r.train}</div>
                      <div className="px-3 py-2.5 text-amber-300/80 font-mono" style={{ background: i % 2 === 0 ? '#090E16' : '#07090F' }}>{r.val}</div>
                      <div className="px-3 py-2.5 text-violet-300 font-mono font-semibold" style={{ background: i % 2 === 0 ? '#090E16' : '#07090F' }}>{r.test}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.07) 0%, transparent 100%)', borderBottom: '1px solid rgba(239,68,68,0.18)' }}>
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-xs font-semibold text-zinc-200">Deadly Errors</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25 ml-1">8 critical</span>
                </div>
              </div>
              <div className="p-4 space-y-2">
                {DEADLY_ERRORS.map(e => (
                  <div key={e.error}
                    className="flex gap-3 p-2.5 rounded-[9px]"
                    style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                    <div className="w-0.5 rounded-full shrink-0" style={{ background: 'rgba(239,68,68,0.5)', minHeight: 32 }} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-rose-300 leading-snug">{e.error}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">{e.impact}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Col 3 */}
          <div className="space-y-5">
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06]" style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, transparent 100%)' }}>
                <div className="flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-xs font-semibold text-zinc-200">Priority Ranking</span>
                </div>
              </div>
              <div className="p-4 space-y-2.5">
                {PRIORITY.map(r => (
                  <div key={r.label} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[11px] text-zinc-300 leading-none">{r.label}</span>
                      <span className="text-[10px] font-bold font-mono" style={{ color: r.barColor }}>{r.score}/10</span>
                    </div>
                    <div className="h-[5px] rounded-full bg-white/[0.05]">
                      <div className="h-[5px] rounded-full" style={{ width: `${r.score * 10}%`, background: r.barColor + 'CC' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06]" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.05) 0%, transparent 100%)' }}>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-zinc-200">Pipeline Flow</span>
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="relative">
                  <div className="absolute left-[10px] top-3 bottom-3 w-[2px] bg-gradient-to-b from-cyan-500/30 via-violet-500/20 to-emerald-500/30" />
                  <div className="space-y-0">
                    {FLOW_STEPS.map((f, i) => {
                      const p = PHASE_META[f.phase]
                      return (
                        <div key={i} className="flex items-center gap-3 py-[7px] relative">
                          <div
                            className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 z-10"
                            style={{ background: p.badgeBg, border: `1.5px solid ${p.accent}60`, color: p.text }}
                          >
                            {i + 1}
                          </div>
                          <span className="text-[11px] text-zinc-300 leading-snug">{f.step}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

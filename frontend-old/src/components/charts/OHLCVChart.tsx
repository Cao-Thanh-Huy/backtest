'use client'
/**
 * Candlestick + volume chart powered by lightweight-charts v4.
 * Accepts raw OHLCV rows from the /chart-data backend endpoint.
 */
import { useEffect, useRef } from 'react'
import {
  createChart,
  ColorType,
  IChartApi,
  CandlestickData,
  HistogramData,
  Time,
} from 'lightweight-charts'

export interface ChartBar {
  time: number | string
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

interface Props {
  data: ChartBar[]
  height?: number
}

const UP_COLOR   = '#22c55e'
const DOWN_COLOR = '#ef4444'
const BG_COLOR   = 'transparent'
const GRID_COLOR = '#1e293b'
const TEXT_COLOR = '#94a3b8'

export function OHLCVChart({ data, height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || !data.length) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: BG_COLOR },
        textColor: TEXT_COLOR,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      rightPriceScale: { borderColor: GRID_COLOR },
      timeScale: { borderColor: GRID_COLOR, timeVisible: true },
      width: containerRef.current.clientWidth,
      height,
    })
    chartRef.current = chart

    // Sort ascending by time
    const sorted = [...data].sort((a, b) => {
      const ta = typeof a.time === 'number' ? a.time : a.time
      const tb = typeof b.time === 'number' ? b.time : b.time
      return ta < tb ? -1 : ta > tb ? 1 : 0
    })

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor:        UP_COLOR,
      downColor:      DOWN_COLOR,
      borderVisible:  false,
      wickUpColor:    UP_COLOR,
      wickDownColor:  DOWN_COLOR,
    })
    candleSeries.setData(
      sorted.map((d) => ({
        time:  d.time as Time,
        open:  Number(d.open),
        high:  Number(d.high),
        low:   Number(d.low),
        close: Number(d.close),
      })) satisfies CandlestickData[]
    )

    // Volume histogram (optional)
    const hasVolume = sorted.some((d) => d.volume != null && d.volume !== 0)
    if (hasVolume) {
      const volSeries = chart.addHistogramSeries({
        color:       '#334155',
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      })
      chart.priceScale('vol').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      })
      volSeries.setData(
        sorted.map((d) => ({
          time:  d.time as Time,
          value: Number(d.volume ?? 0),
          color: Number(d.close) >= Number(d.open) ? '#166534' : '#7f1d1d',
        })) satisfies HistogramData[]
      )
    }

    chart.timeScale().fitContent()

    const onResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
      chartRef.current = null
    }
  }, [data, height])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden border border-surface-border"
      style={{ height }}
    />
  )
}

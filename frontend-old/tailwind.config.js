/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep navy-tinted dark — richer than pure black
        surface: {
          DEFAULT:   '#07090F',   // app background — near-black with blue tint
          secondary: '#0C1018',   // sidebar / left panels — noticeably darker navy
          card:      '#111928',   // cards — blue-grey dark
          elevated:  '#1A2438',   // popovers, elevated panels
          hover:     '#151D2B',   // subtle hover fill
          border:    'rgba(255,255,255,0.06)',
          'border-strong': 'rgba(255,255,255,0.12)',
        },
        // Vivid violet-indigo brand — more saturated, pops against dark bg
        brand: {
          DEFAULT: '#7C3AED',   // violet-700 — rich, not washed out
          300:     '#C4B5FD',   // violet-300 — light text
          400:     '#A78BFA',   // violet-400 — icons, muted accent
          500:     '#8B5CF6',   // violet-500
          600:     '#7C3AED',   // alias
          glow:    'rgba(124,58,237,0.25)',
          soft:    'rgba(139,92,246,0.12)',
        },
        // Sidebar icon accent palette — each nav section a distinct hue
        accent: {
          cyan:   '#06B6D4',
          teal:   '#14B8A6',
          green:  '#22C55E',
          amber:  '#F59E0B',
          rose:   '#F43F5E',
          indigo: '#6366F1',
          sky:    '#38BDF8',
          purple: '#A855F7',
        },
        // Semantic — financial-grade
        up:   '#22C55E',   // green-500 — clear positive
        down: '#EF4444',   // red-500
        warn: '#F59E0B',   // amber-500
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        heading: '-0.025em',
        label:   '0.07em',
      },
      borderRadius: {
        sm:    '8px',
        md:    '12px',
        card:  '14px',
        modal: '18px',
        lg:    '18px',
        xl:    '24px',
      },
      boxShadow: {
        sm:        '0 1px 2px rgba(0,0,0,0.30)',
        card:      '0 2px 8px rgba(0,0,0,0.35)',
        elevated:  '0 8px 32px rgba(0,0,0,0.50)',
        lg:        '0 12px 48px rgba(0,0,0,0.55)',
        'brand-glow': '0 0 20px rgba(124,58,237,0.30)',
        'icon-glow':  '0 0 12px rgba(124,58,237,0.50)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6D28D9 0%, #4F46E5 100%)',
        'surface-gradient': 'linear-gradient(180deg, #111928 0%, #0C1018 100%)',
      },
    },
  },
  plugins: [],
}

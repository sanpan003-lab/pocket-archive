/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          400: '#94A3B8',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
          DEFAULT: '#0F172A',
        },
        // Accent color (Settings → Theme → Accent): CSS variables set per [data-accent] in index.css
        gold: {
          50:  'rgb(var(--accent-50) / <alpha-value>)',
          100: 'rgb(var(--accent-100) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
          700: 'rgb(var(--accent-700) / <alpha-value>)',
          DEFAULT: 'rgb(var(--accent-500) / <alpha-value>)',
        },
      },
      backgroundImage: {
        'app-gradient':  'linear-gradient(160deg, #EEF2FF 0%, #F8FAFC 40%, #FFFBF0 100%)',
        'gold-gradient': 'linear-gradient(135deg, rgb(var(--accent-500)) 0%, rgb(var(--accent-600)) 100%)',
        // The logo stays gold whatever the accent color
        'brand-gradient': 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
        'navy-gradient': 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glass':       '0 4px 24px rgba(15,23,42,0.06), 0 1px 4px rgba(15,23,42,0.04)',
        'glass-hover': '0 8px 32px rgba(15,23,42,0.10), 0 2px 8px rgba(15,23,42,0.06)',
        'glass-lg':    '0 16px 48px rgba(15,23,42,0.12), 0 4px 12px rgba(15,23,42,0.06)',
        'gold':        '0 4px 16px rgb(var(--accent-500) / 0.30)',
        'gold-hover':  '0 6px 24px rgb(var(--accent-500) / 0.45)',
        'brand':       '0 4px 16px rgba(245,158,11,0.30)',
      },
      borderRadius: {
        'xl2': '20px',
      },
      animation: {
        'fade-in':   'fadeIn 0.25s ease-out',
        'slide-in':  'slideIn 0.25s ease-out',
        'slide-up':  'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0', transform: 'translateY(6px)' },
                   to:   { opacity: '1', transform: 'translateY(0)' } },
        slideIn: { from: { opacity: '0', transform: 'translateX(-10px)' },
                   to:   { opacity: '1', transform: 'translateX(0)' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(16px)' },
                   to:   { opacity: '1', transform: 'translateY(0)' } },
      },
      transitionTimingFunction: {
        'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
}

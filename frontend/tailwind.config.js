/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        // Editorial display face for marketing headlines and a few large in-app titles.
        display: ['"Instrument Serif"', 'Georgia', 'Cambria', '"Times New Roman"', 'serif'],
      },
      colors: {
        // Paheli green. 600 is the primary action colour (4.6:1 on white), 700 the deep green.
        brand: {
          50: '#EAF5EA',
          100: '#D4EBD6',
          200: '#AAD7B0',
          300: '#78BF85',
          400: '#4AA65C',
          500: '#2E9444',
          600: '#238636',
          700: '#176B2C',
          800: '#125424',
          900: '#0E401C',
          950: '#072611',
        },
        // Warm accent used sparingly in illustrations and motion (never for text on white).
        spark: { DEFAULT: '#F2A93B', soft: '#FDF1DC' },
        ink: { DEFAULT: '#141A16', soft: '#343F38', muted: '#5F6B63', faint: '#8B968E' },
        canvas: '#F6F7F5',
        line: { DEFAULT: '#E6EAE6', strong: '#CFD8D0' },
        warn: { DEFAULT: '#D99A20', ink: '#8A5D0B', soft: '#FCF4E3' },
        danger: { DEFAULT: '#C63D3D', ink: '#9B2C2C', soft: '#FBECEC' },
        info: { DEFAULT: '#2878B5', ink: '#1D5A88', soft: '#E9F2F9' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 26, 22, 0.04)',
        pop: '0 16px 40px -16px rgba(20, 26, 22, 0.28), 0 2px 6px rgba(20, 26, 22, 0.06)',
        glow: '0 0 0 6px rgba(35, 134, 54, 0.12)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.35s ease-out both',
        'slide-up': 'slideUp 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'slide-in-right': 'slideInRight 0.25s ease-out both',
        'slide-in-left': 'slideInLeft 0.25s ease-out both',
        'scale-in': 'scaleIn 0.18s ease-out both',
        'page-in': 'pageIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'blur-in': 'blurIn 0.8s cubic-bezier(0.22, 1, 0.36, 1) both',
        'word-in': 'wordIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 6s ease-in-out infinite',
        'float-slow': 'float 9s ease-in-out infinite',
        marquee: 'marquee 38s linear infinite',
        'dash-flow': 'dashFlow 1.2s linear infinite',
        'ping-soft': 'pingSoft 2.4s cubic-bezier(0, 0, 0.2, 1) infinite',
        'spin-slow': 'spin 14s linear infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        breathe: 'breathe 3.2s ease-in-out infinite',
        caret: 'caret 1s steps(1) infinite',
        'grow-x': 'growX var(--grow-duration, 4s) linear both',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pageIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blurIn: {
          '0%': { opacity: '0', filter: 'blur(10px)', transform: 'translateY(16px)' },
          '100%': { opacity: '1', filter: 'blur(0)', transform: 'translateY(0)' },
        },
        wordIn: {
          '0%': { opacity: '0', transform: 'translateY(60%)', filter: 'blur(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)', filter: 'blur(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -8px, 0)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        dashFlow: {
          '0%': { strokeDashoffset: '16' },
          '100%': { strokeDashoffset: '0' },
        },
        pingSoft: {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '80%, 100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.06)' },
        },
        caret: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        growX: {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      }
    },
  },
  plugins: [],
}

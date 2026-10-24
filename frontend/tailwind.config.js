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
      },
      colors: {
        // Hypnexis green. 600 is the primary action colour (4.6:1 on white), 700 the deep green.
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
        ink: { DEFAULT: '#17211B', soft: '#36423A', muted: '#647067', faint: '#8B968E' },
        canvas: '#F7F9F7',
        line: { DEFAULT: '#E4EAE4', strong: '#CFD8D0' },
        warn: { DEFAULT: '#D99A20', ink: '#8A5D0B', soft: '#FCF4E3' },
        danger: { DEFAULT: '#C63D3D', ink: '#9B2C2C', soft: '#FBECEC' },
        info: { DEFAULT: '#2878B5', ink: '#1D5A88', soft: '#E9F2F9' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(23, 33, 27, 0.04), 0 1px 3px rgba(23, 33, 27, 0.05)',
        pop: '0 12px 32px -12px rgba(23, 33, 27, 0.28), 0 2px 6px rgba(23, 33, 27, 0.06)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.35s ease-out both',
        'slide-up': 'slideUp 0.3s ease-out both',
        'slide-in-right': 'slideInRight 0.25s ease-out both',
        'slide-in-left': 'slideInLeft 0.25s ease-out both',
        'scale-in': 'scaleIn 0.18s ease-out both',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
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
      }
    },
  },
  plugins: [],
}

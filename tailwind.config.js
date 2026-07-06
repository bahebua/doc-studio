/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          soft: '#f8fafc',
          muted: '#f1f5f9',
          border: '#e2e8f0',
        },
        night: {
          DEFAULT: '#0b1220',
          soft: '#111827',
          muted: '#1f2937',
          border: '#334155',
        },
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#b7ccff',
          300: '#8aa9ff',
          400: '#5e83ff',
          500: '#3b60f5',
          600: '#2a48d6',
          700: '#2338a8',
          800: '#1e3084',
          900: '#1c2a68',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(15,23,42,0.06)',
        pop: '0 10px 30px rgba(15,23,42,0.12)',
      },
      borderRadius: {
        xl: '0.9rem',
        '2xl': '1.15rem',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 180ms ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // sensitivity palette
        sens: {
          none: '#64748b',
          low: '#0891b2',
          medium: '#d97706',
          high: '#dc2626',
        },
      },
    },
  },
  plugins: [],
};

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Geega Games brand identity: rebeccapurple.
        brand: {
          DEFAULT: '#663399',
          50: '#f5f0fa',
          100: '#e9ddf5',
          200: '#d3bbea',
          300: '#b590db',
          400: '#9866c9',
          500: '#7d47b3',
          600: '#663399',
          700: '#54297d',
          800: '#402060',
          900: '#2d1745',
        },
      },
    },
  },
  plugins: [],
};
export default config;

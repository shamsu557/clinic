module.exports = {
  content: ['./public/index.html', './public/assets/js/*.js'],
  theme: { extend: {
    colors: {
      brand: { ink: '#2b2d2e', teal: '#1f4e5f', gold: '#b8864b', ivory: '#faf8f4', mist: '#eaf1f3' },
      // the whole app's "blue" now follows the logo's deep teal-navy
      blue: { 50: '#eef5f7', 100: '#d8e8ee', 200: '#b3d1dc', 300: '#85b3c4', 400: '#4f8aa1', 500: '#2f6a82', 600: '#1f4e5f', 700: '#193f4d', 800: '#14323d', 900: '#0f252d' },
    },
    fontFamily: {
      sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      display: ['Cinzel', 'Trajan Pro', 'Optima', 'Georgia', 'serif'],
      script: ['Cormorant Garamond', 'Garamond', 'Georgia', 'serif'],
    },
  } },
  plugins: [],
};

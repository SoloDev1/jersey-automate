/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        whatsapp: {
          light: '#25D366',
          dark: '#075E54',
          bg: '#E5DDD5',
          chat: '#ECE5DD'
        }
      }
    },
  },
  plugins: [],
}

import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        comic: ['"Comic Neue"', '"Comic Sans MS"', 'cursive', 'sans-serif'],
      },
      animation: {
        bounce: 'bounce 1s infinite',
      },
      colors: {
        'yellow-100': '#FEF9C3',
        'blue-200': '#BFDBFE',
        'green-200': '#BBF7D0',
        'green-300' : '#99ffcc',
        'green-400' : '#66ffb3',
        'green-700' : '#2bcd42',
        'green-800' : '#3b934c',
        'purple-200': '#E9D5FF',
        'purple-700': '#9c04fb',
        'red-500': '#fc5e56',
        'yellow-500': '#ffc464',
        'green-500': '#2bcd42',
        'blue-700': '#1a365d',
        'orange-900': '#4a3020',
      },
    },
  },
  plugins: [],
} satisfies Config;

/** @type {import('tailwindcss').Config} */
module.exports = {
    mode: 'jit',
    content: [
        "./src/**/*.{vue,js,ts,jsx,tsx}",
        "./index.html"
    ],
    theme: {
        screens: {
            sm: '480px',
            md: '768px',
            lg: '976px',
            xl: '1440px',
        },
        fontFamily: {
            norm: ['JetBrains'],
            bold: ['JetBrains Bold'],
        },
        extend: {
            colors: {
                'slate-950': '#020617',
                'slate-900': '#0f172a',
                'slate-800': '#1e293b',
                'slate-700': '#334155',
                'slate-600': '#475569',
                'slate-400': '#94a3b8',
                'slate-200': '#e2e8f0',
                'slate-50': '#f8fafc',
                'teal-400': '#2dd4bf',
                'teal-500': '#14b8a6',
                'teal-600': '#0d9488',
                'teal-900': '#134e4a',
            },
            spacing: {
                '128': '32rem',
                '144': '36rem',
            },
            borderRadius: {
                '4xl': '2rem',
            }
        }
    },
    plugins: [],
}

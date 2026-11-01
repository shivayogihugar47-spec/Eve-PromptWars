import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg:       "#F4F6F8",
        surface:  "#FFFFFF",
        surface2: "#F0F2F5",
        border:   "#E8EAED",
        heading:  "#111827",
        body:     "#374151",
        muted:    "#9CA3AF",
        accent:   "#6366F1",
        accent2:  "#8B5CF6",
        // Pastel category pill backgrounds (from reference image)
        pastel: {
          green:    "#D1FAE5",
          teal:     "#CCFBF1",
          blue:     "#DBEAFE",
          purple:   "#EDE9FE",
          pink:     "#FCE7F3",
          orange:   "#FEF3C7",
          red:      "#FEE2E2",
          indigo:   "#E0E7FF",
        },
        // Pastel text colors
        pastelText: {
          green:    "#065F46",
          teal:     "#0F766E",
          blue:     "#1D4ED8",
          purple:   "#6D28D9",
          pink:     "#9D174D",
          orange:   "#92400E",
          red:      "#991B1B",
          indigo:   "#3730A3",
        },
      },
      fontFamily: {
        display: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        body:    ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "20px",
        btn:  "12px",
        xl2:  "16px",
        xl3:  "20px",
        xl4:  "24px",
      },
      boxShadow: {
        sm:   "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
        card: "0 4px 16px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)",
        lg:   "0 12px 40px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04)",
        accent: "0 4px 20px rgba(99,102,241,0.25)",
      },
      animation: {
        "spin-slow": "spin 3s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;

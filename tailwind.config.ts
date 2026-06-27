import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      screens: {
        'xs': '475px',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        // Tasks / Delivery module status, priority & role colors
        "status-pending": { DEFAULT: "hsl(var(--status-pending))", light: "hsl(var(--status-pending-light))" },
        "status-doing": { DEFAULT: "hsl(var(--status-doing))", light: "hsl(var(--status-doing-light))" },
        "status-done": { DEFAULT: "hsl(var(--status-done))", light: "hsl(var(--status-done-light))" },
        "status-refused": { DEFAULT: "hsl(var(--status-refused))", light: "hsl(var(--status-refused-light))" },
        "priority-low": "hsl(var(--priority-low))",
        "priority-medium": "hsl(var(--priority-medium))",
        "priority-high": "hsl(var(--priority-high))",
        "priority-urgent": "hsl(var(--priority-urgent))",
        "role-sales": { DEFAULT: "hsl(var(--role-sales))", light: "hsl(var(--role-sales-light))" },
        "role-technician": { DEFAULT: "hsl(var(--role-technician))", light: "hsl(var(--role-technician-light))" },
        "role-driver": { DEFAULT: "hsl(var(--role-driver))", light: "hsl(var(--role-driver-light))" },
        "role-admin": { DEFAULT: "hsl(var(--role-admin))", light: "hsl(var(--role-admin-light))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;

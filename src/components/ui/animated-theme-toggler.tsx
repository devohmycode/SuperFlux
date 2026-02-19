import { useCallback, useEffect, useRef, useState } from "react"
import { Moon, Sun, Sunrise } from "lucide-react"
import { flushSync } from "react-dom"

import { cn } from "@/lib/utils"

type Theme = "light" | "sepia" | "dark"

const THEME_ORDER: Theme[] = ["light", "sepia", "dark"]

function getTheme(): Theme {
  if (document.documentElement.classList.contains("dark")) return "dark"
  if (document.documentElement.classList.contains("sepia")) return "sepia"
  return "light"
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove("dark", "sepia")
  if (theme !== "light") {
    document.documentElement.classList.add(theme)
  }
  localStorage.setItem("theme", theme)
}

const ThemeIcon = ({ theme }: { theme: Theme }) => {
  if (theme === "dark") return <Moon />
  if (theme === "sepia") return <Sunrise />
  return <Sun />
}

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  ...props
}: AnimatedThemeTogglerProps) => {
  const [theme, setTheme] = useState<Theme>("light")
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const updateTheme = () => setTheme(getTheme())
    updateTheme()

    const observer = new MutationObserver(updateTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  const toggleTheme = useCallback(async () => {
    if (!buttonRef.current) return

    const currentIndex = THEME_ORDER.indexOf(theme)
    const nextTheme = THEME_ORDER[(currentIndex + 1) % THEME_ORDER.length]

    await document.startViewTransition(() => {
      flushSync(() => {
        setTheme(nextTheme)
        applyTheme(nextTheme)
      })
    }).ready

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const maxRadius = Math.hypot(
      Math.max(left, window.innerWidth - left),
      Math.max(top, window.innerHeight - top)
    )

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    )
  }, [theme, duration])

  return (
    <button
      ref={buttonRef}
      onClick={toggleTheme}
      className={cn(className)}
      {...props}
    >
      <ThemeIcon theme={theme} />
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}

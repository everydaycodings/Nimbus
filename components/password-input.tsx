"use client"

import {
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  WarningIcon,
} from "@phosphor-icons/react"
import { createContext, useContext, useEffect, useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  type PasswordPolicy,
  minLength,
  passwordRules,
} from "@/lib/password-policy"
import { cn } from "@/lib/utils"

const PolicyContext = createContext<PasswordPolicy | null>(null)

// Set by the layouts from Admin → Settings, so every new-password form agrees.
export function PasswordPolicyProvider({
  policy,
  children,
}: {
  policy: PasswordPolicy | null
  children: React.ReactNode
}) {
  return (
    <PolicyContext.Provider value={policy}>{children}</PolicyContext.Provider>
  )
}

export const usePasswordPolicy = () => useContext(PolicyContext)

// A password field with a show/hide toggle and a Caps Lock warning.
export function PasswordInput({
  className,
  onKeyDown,
  onKeyUp,
  onBlur,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [shown, setShown] = useState(false)
  const [caps, setCaps] = useState(false)
  const readCaps = (e: React.KeyboardEvent) =>
    setCaps(e.getModifierState?.("CapsLock") ?? false)

  return (
    <>
      <div className="relative">
        <Input
          type={shown ? "text" : "password"}
          spellCheck={false}
          autoCapitalize="none"
          className={cn("pr-10", className)}
          onKeyDown={(e) => (readCaps(e), onKeyDown?.(e))}
          onKeyUp={(e) => (readCaps(e), onKeyUp?.(e))}
          onBlur={(e) => (setCaps(false), onBlur?.(e))}
          {...props}
        />
        <button
          type="button"
          onClick={() => setShown(!shown)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          aria-controls={props.id}
          disabled={props.disabled}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none [&_svg]:size-4"
        >
          {shown ? <EyeSlashIcon /> : <EyeIcon />}
        </button>
      </div>
      {caps && (
        <p className="flex items-center gap-1.5 text-xs text-tag-yellow">
          <WarningIcon weight="fill" className="size-3.5" />
          Caps Lock is on
        </p>
      )}
    </>
  )
}

const STRENGTH = [
  { label: "Very weak", bar: "bg-destructive", text: "text-destructive" },
  { label: "Weak", bar: "bg-destructive", text: "text-destructive" },
  { label: "Fair", bar: "bg-tag-yellow", text: "text-tag-yellow" },
  { label: "Strong", bar: "bg-tag-green", text: "text-tag-green" },
  { label: "Very strong", bar: "bg-tag-green", text: "text-tag-green" },
]

// zxcvbn reports warnings as keys; only language-common is installed, so the
// words live here.
const WARNINGS: Record<string, string> = {
  straightRow: "Rows of keys are easy to guess.",
  keyPattern: "Short keyboard patterns are easy to guess.",
  simpleRepeat: "Repeated characters like “aaa” are easy to guess.",
  extendedRepeat: "Repeated patterns like “abcabc” are easy to guess.",
  sequences: "Sequences like “abc” or “123” are easy to guess.",
  recentYears: "Recent years are easy to guess.",
  dates: "Dates are easy to guess.",
  topTen: "This is one of the most used passwords.",
  topHundred: "This is a very commonly used password.",
  common: "This is a commonly used password.",
  similarToCommon: "This is close to a commonly used password.",
  wordByItself: "Single words are easy to guess.",
  namesByThemselves: "Names on their own are easy to guess.",
  commonNames: "Common names are easy to guess.",
  userInputs: "Leave out personal details.",
  pwned: "This password showed up in a data breach.",
}

type Zxcvbn = (pw: string) => {
  score: number
  feedback: { warning: string | null }
}

// zxcvbn is ~800 KB with its dictionary, so it loads once, on first use.
let loading: Promise<Zxcvbn> | null = null
function loadZxcvbn() {
  loading ??= Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
  ]).then(([core, common]) => {
    core.zxcvbnOptions.setOptions({
      dictionary: common.dictionary,
      graphs: common.adjacencyGraphs,
    })
    return core.zxcvbn as Zxcvbn
  })
  return loading
}

// A four-segment strength bar with a one-line verdict under a new password,
// plus a checklist when the owner has set character rules.
export function StrengthMeter({
  id,
  password,
  vault = false,
}: {
  id: string
  password: string
  vault?: boolean
}) {
  const policy = usePasswordPolicy()
  const min = minLength(policy, vault)
  const rules = passwordRules(policy)
  const hint =
    `At least ${min} characters.` +
    (vault && !policy ? " A few random words work well." : "")
  const [check, setCheck] = useState<Zxcvbn | null>(null)
  useEffect(() => {
    let live = true
    loadZxcvbn().then((fn) => live && setCheck(() => fn))
    return () => {
      live = false
    }
  }, [])

  const short = password.length < min
  const result = !short && check ? check(password) : null
  const s = result ? STRENGTH[result.score] : password ? STRENGTH[0] : null
  // Any typing lights the first segment, so the bar never looks dead.
  const filled = result ? Math.max(result.score, 1) : password ? 1 : 0
  const left = min - password.length
  const key = result?.feedback.warning
  const warning = key ? (WARNINGS[key] ?? key) : null

  return (
    <div className="grid gap-1.5">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full bg-muted transition-colors duration-300",
              s && filled > i && s.bar
            )}
          />
        ))}
      </div>
      <p id={id} aria-live="polite" className="text-xs text-muted-foreground">
        {!password ? (
          hint
        ) : short ? (
          `${left} more character${left === 1 ? "" : "s"} to go.`
        ) : result && s ? (
          <>
            <span className={cn("font-medium", s.text)}>{s.label}.</span>
            {warning
              ? ` ${warning}`
              : result.score < 3 &&
                " Longer is stronger: try a few random words."}
          </>
        ) : (
          "Checking…"
        )}
      </p>
      {rules.length > 0 && (
        <ul className="grid gap-1 text-xs">
          {rules.map((r) => {
            const ok = r.ok(password)
            return (
              <li
                key={r.label}
                className={cn(
                  "flex items-center gap-1.5 transition-colors",
                  ok ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {ok ? (
                  <CheckIcon weight="bold" className="size-3.5 text-brand" />
                ) : (
                  <span
                    aria-hidden
                    className="grid size-3.5 place-items-center"
                  >
                    <span className="size-1 rounded-full bg-current" />
                  </span>
                )}
                {r.label}
                <span className="sr-only">{ok ? "(done)" : "(not yet)"}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// New password plus confirmation, with a strength meter and a live match check.
export function NewPasswordFields({
  name = "password",
  label = "New password",
  autoFocus,
}: {
  name?: string
  label?: string
  autoFocus?: boolean
}) {
  const min = minLength(usePasswordPolicy())
  const [pass, setPass] = useState("")
  const [again, setAgain] = useState("")
  // Only call it a mismatch once they've typed as much as the password.
  const mismatch = again.length >= pass.length && again !== pass

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={name}>{label}</Label>
        <PasswordInput
          id={name}
          name={name}
          autoComplete="new-password"
          minLength={min}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          aria-describedby={`${name}-hint`}
          required
          autoFocus={autoFocus}
        />
        <StrengthMeter id={`${name}-hint`} password={pass} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm {label.toLowerCase()}</Label>
        <PasswordInput
          id="confirm"
          name="confirm"
          autoComplete="new-password"
          minLength={min}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          aria-invalid={(again && mismatch) || undefined}
          aria-describedby="confirm-status"
          required
        />
        <p
          id="confirm-status"
          aria-live="polite"
          className={cn(
            "flex min-h-4 items-center gap-1.5 text-xs",
            mismatch ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {again &&
            (mismatch ? (
              "Doesn't match yet."
            ) : (
              <>
                <CheckIcon weight="bold" className="size-3.5 text-brand" />
                Passwords match.
              </>
            ))}
        </p>
      </div>
    </>
  )
}

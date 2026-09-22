/**
 * Safe Variable Expression Resolver for Flows and Automations
 *
 * Resolves expressions like `{{vars.user.name}}`, `{{contact.name}}`,
 * `{{vars.order.items.0.sku}}`, and supports fallbacks like `{{vars.name || "Valued Customer"}}`.
 * Guarantees zero crashes on missing properties or null references.
 */

/**
 * Safely extracts a nested property by dot/bracket path from an object.
 * Example: `getNestedValue(obj, "order.items.0.title")`
 */
export function getNestedValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || !path) return undefined

  const keys = path
    .replace(/\[(\d+)\]/g, '.$1') // convert [0] to .0
    .split('.')
    .filter(Boolean)

  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined
    }
    current = (current as Record<string, unknown>)[key]
  }

  return current
}

/**
 * Resolves all `{{ ... }}` variable interpolations in a template string.
 *
 * Supported formats:
 * - `{{vars.customer_name}}`
 * - `{{contact.phone}}`
 * - `{{vars.api_data.user.email}}`
 * - `{{vars.first_name || "Friend"}}` (fallback syntax with `||` or `|`)
 */
export function resolveTemplateExpression(
  template: string,
  context: Record<string, unknown>
): string {
  if (!template || typeof template !== 'string') return ''

  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expression: string) => {
    const trimmed = expression.trim()

    // Check for fallback syntax: `path || "fallback"` or `path | "fallback"`
    let path = trimmed
    let fallback = ''

    const fallbackMatch = trimmed.match(/^(.+?)\s*(?:\|\||\|)\s*["']?([^"']*)["']?$/)
    if (fallbackMatch) {
      path = fallbackMatch[1].trim()
      fallback = fallbackMatch[2].trim()
    }

    const value = getNestedValue(context, path)

    if (value !== undefined && value !== null) {
      if (typeof value === 'object') {
        try {
          return JSON.stringify(value)
        } catch {
          return String(value)
        }
      }
      return String(value)
    }

    return fallback
  })
}

export const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * Normalises and checks a team member's display name.
 *
 * Collapses runs of whitespace (including newlines and tabs) to one
 * space and trims the ends, then rejects empty names, names over
 * MAX_DISPLAY_NAME_LENGTH characters and any remaining control
 * characters.
 */
export function validateDisplayName(
  value: unknown,
): { name: string } | { error: string } {
  if (typeof value !== "string") {
    return { error: "Name must be text" };
  }
  const name = value.replace(/\s+/g, " ").trim();
  if (name.length === 0) {
    return { error: "Name can't be empty" };
  }
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      error: `Name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer`,
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return { error: "Name contains characters that aren't allowed" };
  }
  return { name };
}

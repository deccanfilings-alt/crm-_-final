export function renderTemplateBody(body: string, params: string[]): string {
  let paramIdx = 0;
  return body.replace(/\{\{([^}]+)\}\}/g, (match, raw) => {
    const num = Number(raw);
    if (!isNaN(num) && num >= 1) {
      return params[num - 1] ?? match;
    }
    const val = params[paramIdx++];
    return val && val.trim().length > 0 ? val : match;
  });
}

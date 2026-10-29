/** Accept only public identity routes; preserve their query and record real scanner input. */
export function profileRoute(input: string, source?: 'scan' | 'link'): string | undefined {
  try {
    const text = input.trim()
    if (!text) return undefined
    const url = new URL(/^(?:https?:\/\/|\/)/.test(text) ? text : `/p/${encodeURIComponent(text)}`, location.origin)
    if (!/^\/(?:u|p)\/[^/]+\/?$/.test(url.pathname)) return undefined
    if (source === 'scan') url.searchParams.set('s', 'scan')
    return url.pathname + url.search
  } catch { return undefined }
}

/**
 * Test environment setup.
 *
 * This jsdom environment exposes `window.localStorage` as a bare object with no Storage methods,
 * so preset persistence cannot be exercised without a real implementation. The app already
 * degrades gracefully when storage is unusable — that path is covered by its own test — but the
 * saving logic needs somewhere to save.
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>()

  get length(): number {
    return this.#map.size
  }
  clear(): void {
    this.#map.clear()
  }
  getItem(key: string): string | null {
    return this.#map.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.#map.delete(key)
  }
  setItem(key: string, value: string): void {
    this.#map.set(key, String(value))
  }
}

if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  Object.defineProperty(window, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  })
}

/**
 * Per-browser conveniences (drafts, your signature). Storage can be missing or
 * full (private windows, blocked site data); the app works without it.
 */
const PREFIX = 'halfpic:';
export function load(key) {
    try {
        const s = localStorage.getItem(PREFIX + key);
        return s === null ? null : JSON.parse(s);
    }
    catch {
        return null;
    }
}
export function save(key, value) {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
    catch {
        // ignore: drafts are a convenience
    }
}
export function remove(key) {
    try {
        localStorage.removeItem(PREFIX + key);
    }
    catch {
        // ignore
    }
}

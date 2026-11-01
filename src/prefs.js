// Small settings kept in this browser, shared by the app and the sign-in screens.
export const DEVICE_ONLY = "alkansave.deviceOnly";

export const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} }
};

export const homeUrl = code => location.origin + "/" + (code ? `?invite=${encodeURIComponent(code)}` : "");

// Device-only mode is remembered so the sign-in screen doesn't return on every launch.
export function leaveDeviceOnly() { store.del(DEVICE_ONLY); location.replace(homeUrl()); }

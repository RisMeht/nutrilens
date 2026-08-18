"use client";

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

// User-controlled, defaults to on. Read fresh on every call rather than cached in a module
// variable — the Settings panel and any call site can be on different components entirely, and
// localStorage is the one thing guaranteed to already be in sync between them.
const HAPTICS_KEY = "viva-haptics-v1";
export const getHapticsEnabled = (): boolean => {
  try {
    const v = localStorage.getItem(HAPTICS_KEY);
    return v === null ? true : v === "1";
  } catch { return true; }
};
export const setHapticsEnabled = (on: boolean) => {
  try { localStorage.setItem(HAPTICS_KEY, on ? "1" : "0"); } catch { /* best-effort */ }
};

// Real Taptic Engine feedback only exists inside the native iOS app (window.Capacitor is
// injected by Capacitor's own bridge before any page script runs). In a plain mobile browser
// tab there's no equivalent worth faking — navigator.vibrate is Android-Chrome-only, produces a
// crude buzz nothing like the native feel, and is entirely unsupported on mobile Safari (where
// this app's actual PWA/browser users are) — so outside the native app these calls are just a
// no-op rather than a degraded approximation.
const isNative = () => typeof window !== "undefined" && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

// A rejected haptics call (e.g. "Haptics plugin is not implemented on ios", thrown by
// @capacitor/core when the native plugin isn't actually linked into the built binary) used to
// be swallowed completely silently — indistinguishable from haptics simply being off. Logging it
// costs nothing (never surfaces to the user, this app has no visible error UI for it) and turns
// an invisible failure into something checkable via Safari's Web Inspector (Develop menu > your
// device > this page, while the app is running) if haptics still don't fire after a rebuild.
const logHapticFailure = (e: unknown) => { console.warn("[haptics]", e); };

// Regular button taps (flash, help, photo picker) — a light, snappy impact.
export const hapticTap = () => {
  if (!isNative() || !getHapticsEnabled()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(logHapticFailure);
};
// Switching tabs/pages (History/Recs/Scan/Top/Search) — iOS's own "selection changed" feedback
// is a noticeably lighter, quicker tick than an impact style, matching what a picker/segmented
// control feels like rather than a button press. The native implementation only actually
// produces feedback once a selection "session" exists (its own UISelectionFeedbackGenerator is
// nil until selectionStart() runs) — calling selectionChanged() on its own, as a one-off tap
// like a tab switch does, is silently a no-op. Starting, changing, then immediately ending one
// is the correct way to get a single discrete tick out of it.
export const hapticSoft = () => {
  if (!isNative() || !getHapticsEnabled()) return;
  Haptics.selectionStart()
    .then(() => Haptics.selectionChanged())
    .then(() => Haptics.selectionEnd())
    .catch(logHapticFailure);
};
// A scan's loading state kicking in (barcode read, or a food photo handed off for analysis).
export const hapticScanStart = () => {
  if (!isNative() || !getHapticsEnabled()) return;
  Haptics.impact({ style: ImpactStyle.Medium }).catch(logHapticFailure);
};
// A result finishing and appearing on screen.
export const hapticResult = () => {
  if (!isNative() || !getHapticsEnabled()) return;
  Haptics.notification({ type: NotificationType.Success }).catch(logHapticFailure);
};

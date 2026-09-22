/**
 * Zero-dependency Web Audio API Notification Chime
 * Synthesizes a gentle, premium two-tone notification sound (Slack / Apple style)
 * without requiring external .mp3 files or network requests.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playNotificationChime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Tone 1: 587.33 Hz (D5) - gentle start
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);

    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.26);

    // Tone 2: 880 Hz (A5) - cheerful resolution
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, now + 0.12);

    gain2.gain.setValueAtTime(0.0001, now + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.15, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(now + 0.12);
    osc2.stop(now + 0.56);
  } catch (err) {
    // Audio playback can occasionally be blocked if user hasn't interacted with page yet
    console.debug("[notification-sound] Chime playback suppressed:", err);
  }
}

/** Start phones and tablets conservatively; iPadOS can advertise a desktop Mac user agent. */
export const mobileRendering = /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Cap every full-screen canvas, including effects that use their own Pixi renderer. */
export const renderResolution = () => Math.min(window.devicePixelRatio, mobileRendering ? 1 : 2);

/** Only the installed APK opts into its coordinated rendering pipeline. */
export const androidApp = !!(window as Window & { Sts2Android?: unknown }).Sts2Android;

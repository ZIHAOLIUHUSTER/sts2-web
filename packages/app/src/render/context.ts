import type { Application } from 'pixi.js';

const sync = new Set<() => void>();
let observer: MutationObserver | undefined;

/** Keep cached auxiliary renderers, but release their GPU contexts between screens. */
export function suspendWhenDetached(a: Application) {
  const renderer = a.renderer;
  if (!('gl' in renderer)) return;
  const gl = renderer.gl, canvas = a.canvas;
  const loss = gl.getExtension('WEBGL_lose_context');
  if (!loss) return;
  let suspended = false, lossDelivered = false, restoring = false;
  const update = () => {
    if (!canvas.isConnected && !gl.isContextLost()) {
      suspended = true;
      lossDelivered = false;
      loss.loseContext();
    } else if (canvas.isConnected && suspended && lossDelivered && !restoring) {
      restoring = true;
      loss.restoreContext();
    }
  };
  canvas.addEventListener('webglcontextlost', () => {
    lossDelivered = true;
    update();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    suspended = restoring = false;
    update();
    // Some layers only render on demand; repaint them after Pixi has rebuilt its GL resources.
    queueMicrotask(() => { if (canvas.isConnected) a.render(); });
  });
  // Callers can finish asynchronous scene work while detached or while restoration is pending.
  // Drawing on a lost context can otherwise cache invalid shader programs in Pixi.
  renderer.render = new Proxy(renderer.render, {
    apply(render, self, args) { if (!gl.isContextLost()) return Reflect.apply(render, self, args); },
  });
  sync.add(update);
  if (!observer) {
    observer = new MutationObserver(() => { for (const update of sync) update(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  // Allow the caller's mount promise to attach the canvas first, including on its initial creation.
  setTimeout(update, 0);
}

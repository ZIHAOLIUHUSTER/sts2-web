// PlayerHurtVignetteHelper / NLowHpBorderVfx (vfx/ui/vfx_low_hp_border.tscn): a full-screen ColorRect over the global UI
// (self_modulate α 0.753) with vfx_ui_low_hp_border_shader — a dark-red noisy border. Play() runs 1 s: the alpha
// multiplier follows its curve (full until 0.255, then out) and the colour its gradient; a replay restarts the timer.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef } from 'preact/hooks';
import { Application, Texture } from 'pixi.js';
import { $ } from '../game';
import { loadShader, QuadBatch } from '../render/canvas';
import { sceneTexture } from '../render/scene';
import { curveAt } from '../render/cardfx';
import { fullView, corners } from '../view';
import { renderResolution, androidApp } from '../render/quality';

const ALPHA = [[0.2551724, 1, 0, 0], [1, 0.002529502, 0, 0]];
const C0 = [0.7372549, 0, 0], C1 = [0.32156864, 0.02745098, 0.02745098];
const state = { playing: false, t: 0, offset: [0, 0], start: null as null | (() => void) };

let appP: Promise<Application> | null = null;
const vignetteApp = () => (appP ??= (async () => {
  const a = new Application();
  await a.init({ width: 1920, height: 1080, backgroundAlpha: 0, antialias: false, autoStart: false, resolution: renderResolution(), autoDensity: true });
  a.canvas.classList.add('hurt-vignette');
  a.canvas.style.visibility = 'hidden';
  fullView(a, true);
  return a;
})());

/** NLowHpBorderVfx.Play. */
function play() {
  if (state.playing) { state.t = 0; return; }
  state.playing = true;
  state.t = 0;
  state.offset = [Math.random(), Math.random()];
  state.start?.();
}
$.ext('MegaCrit.Sts2.Core.Nodes.Vfx.PlayerHurtVignetteHelper').Play = play;

export function HurtVignette() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let dead = false, quad: QuadBatch | null = null, app: Application | null = null;
    let preparing: Promise<void> | null = null;
    const prepare = () => preparing ??= Promise.all([vignetteApp(), loadShader('shaders/vfx/ui/vfx_ui_low_hp_border_shader.gdshader'), sceneTexture('images/vfx/noise/vfx_noise_1.png')]).then(([a, sh, noise]) => {
      if (dead || !sh) return;
      app = a;
      a.stage.removeChildren();
      host.current?.appendChild(a.canvas);
      quad = new QuadBatch(1, sh, Texture.WHITE, {
        alpha: 1, alpha_multiplier: 0, inner_radius: 0.5, outer_radius: 1.75, noise: noise ?? Texture.WHITE, noise_tiling: [1, 3], noise_panning: [-3, 0],
        noise_initial_offset: [0, 0], noise_additional_offset: 0, smoothstep_factors: [0.1, 0.8], main_color: [...C1, 1],
      });
      // Upload a valid transparent quad before the first render, including at the default viewport size.
      quad.quad(0, corners(), 0, 0, 1, 1, 1, 1, 1, 0);
      quad.flush();
      a.stage.addChild(quad);
      a.render();
    });
    if (!androidApp) void prepare();
    // PlaySequence: 1 s, properties from the curve and the gradient at t / 1 s
    const begin = () => {
        if (dead || !state.playing || !quad || !app) { if (!dead) state.playing = false; return; }
        const color = new Float32Array(4), offset = new Float32Array(2);
        $.onFrame((dt: number) => {
          if (dead || !quad || !app) { state.playing = false; return false; }
          const p = Math.min(state.t / 1, 1), g = Math.min(p / 0.75, 1), u = quad.group.uniforms as any;
          u.alpha_multiplier = curveAt(ALPHA, p);
          for (let i = 0; i < 3; i++) color[i] = C0[i] + (C1[i] - C0[i]) * g;
          color[3] = 1;
          offset.set(state.offset);
          u.main_color = color;
          u.noise_initial_offset = offset;
          quad.group.update();
          quad.quad(0, corners(), 0, 0, 1, 1, 1, 1, 1, 0.7529); // the border of the screen as it is now
          quad.flush();
          app.render();
          app.canvas.style.visibility = 'visible';
          state.t += dt;
          if (p < 1) return true;
          state.playing = false;
          app.canvas.style.visibility = 'hidden';
          return false;
        });
    };
    state.start = () => {
      if (quad && app) begin();
      else void prepare().then(begin);
    };
    return () => {
      dead = true;
      state.start = null;
      state.playing = false;
      quad?.destroy();
      if (app) { app.canvas.style.visibility = 'hidden'; app.stage.removeChildren(); app.canvas.remove(); }
    };
  }, []);
  return <div class="hurt-vignette-host" ref={host} />;
}

// The feedback screen (NSendFeedbackScreen's job: NGame keeps one over everything, the settings' Feedback button opens
// it), drawn with the port's existing pieces instead of the game's pink panel: the rewards screen's reward_panel and
// reward_banner (and its AnimateIn), the custom run's seed input, the settings button and the disclaimer's exit (1000 px
// up, 0.5 s Back In). The game's text: header, Send!, sending / result labels; no category or emoji.
// The feedback goes to the port's author (Tianji survey), not Mega Crit, and the placeholder says so; no screenshot or
// logs; the text is kept when sending fails. The main menu has an entry of its own (ui/menu.tsx PortLinks).
import { useEffect, useRef, useState } from 'preact/hooks';
import { G } from '../game';
import { invalidate } from '../store';
import { playOneShot } from '../audio';
import { imageUrl } from '../assets';
import { loc, appText } from '../i18n';
import { BackButton } from './buttons';
import { SettingsButton } from './settings';

const s = (k: string) => loc('settings_ui', k);
const SURVEY_URL = 'https://app.tianji.dev/open/workspace/cm3pzndpk0001thybosby3rhz/survey/cmutkbqi038y05xc7ohob3k75/submit';

let open = false;
// what survives a close: Open clears it when the screen was closed for over a minute
const draft = { text: '', closedAt: 0 };
export const feedbackOpen = () => open;
/** NSendFeedbackScreen.Open. */
export function openFeedback() {
  if (Date.now() - draft.closedAt > 60000) draft.text = '';
  open = true;
  invalidate();
}
function close() { open = false; draft.closedAt = Date.now(); invalidate(); }

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };
/**
 * One survey field each (Tianji stores keys it has no field for too). Tianji records the browser, OS, browser language
 * and location from the request itself; the seed is there only in a run.
 */
async function send(text: string): Promise<boolean> {
  if (!text.trim()) return true; // SendFeedback: nothing to send, success anyway
  const payload = {
    content: text,
    build: __BUILD_ID__,
    version: 'v0.98.3',
    gameLanguage: safe(() => G.LocManager.Instance.Language, ''),
    viewport: `${innerWidth}x${innerHeight}`,
    seed: safe(() => G.RunManager.Instance.State?.Rng.StringSeed ?? '', ''),
    userAgent: navigator.userAgent,
  };
  try {
    const r = await fetch(SURVEY_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload }) });
    return r.ok;
  } catch { return false; }
}

type Phase = '' | 'sending' | 'success' | 'failed';
const STATUS: Record<Phase, string> = { '': '', sending: 'FEEDBACK_SENDING_LABEL', success: 'FEEDBACK_SEND_SUCCESS_LABEL', failed: 'FEEDBACK_SEND_FAILED_LABEL' };
export function FeedbackScreen() {
  const [, rerender] = useState(0);
  const [phase, setPhase] = useState<Phase>('');
  const [leaving, setLeaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const timers = useRef<number[]>([]), alive = useRef(true);
  useEffect(() => { input.current?.focus(); return () => { alive.current = false; timers.current.forEach(clearTimeout); }; }, []);
  const update = () => rerender((n) => n + 1);
  const later = (ms: number, f: () => void) => { timers.current.push(window.setTimeout(f, ms)); };
  const pressSend = async () => {
    if (phase === 'sending' || phase === 'success') return;
    setPhase('sending');
    const text = draft.text, ok = await send(text);
    if (ok && draft.text === text) draft.text = ''; // ClearInput (unless reopened and edited meanwhile)
    if (!alive.current) return;
    setPhase(ok ? 'success' : 'failed');
    if (ok) { later(1200, () => setLeaving(true)); later(1700, close); }
  };
  return (
    <div class="feedback-screen">
      <div class="fb-bg" />
      <div class={'fb-panel' + (leaving ? ' leaving' : '')}>
        <img class="fb-panel-bg" src={imageUrl('images/ui/reward_screen/reward_panel.png') ?? ''} />
        <div class="fb-banner">
          <img src={imageUrl('images/ui/reward_screen/reward_banner.png') ?? ''} />
          <div class="fb-header">{s('SEND_FEEDBACK')}</div>
        </div>
        <textarea class="fb-input" ref={input} value={draft.text} maxLength={500} placeholder={appText('feedbackPlaceholder')}
          onInput={(e) => { draft.text = (e.target as HTMLTextAreaElement).value; update(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }} />
        <div class={'fb-status ' + phase}>{STATUS[phase] && s(STATUS[phase])}</div>
        <div class={'fb-send' + (phase === 'sending' || phase === 'success' ? ' busy' : '')}>
          <SettingsButton r={{ kind: 'button', label: '', text: s('FEEDBACK_SEND_BUTTON_LABEL'), hsv: [0.82, 1.4, 0.8], outline: 'rgb(32, 66, 36)', onClick: () => void pressSend() }} />
        </div>
      </div>
      <BackButton enabled onClick={close} />
    </div>
  );
}

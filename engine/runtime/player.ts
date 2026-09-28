// Interactive preview (index.html): scrub, play with the soundtrack, step frames.
//   ?s=0.5   render scale (1 = full res)   ?mb=1   enable motion blur   #t=12.5   start time
// Keys: Space play/pause · ←/→ ±1 frame · Shift+←/→ ±1 s · [ ] prev/next shot · M mute · F fullscreen

import { Engine } from '../core/engine';
import type { Project } from '../core/types';
import { loadFilm } from './film';

const q = new URLSearchParams(location.search);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

function fmt(t: number, fps: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t * fps) % fps + 1e-6);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

async function main() {
  const app = document.getElementById('app')!;
  const scale = Number(q.get('s') ?? 0.5);

  const root = el('div', 'player', app);
  const header = el('header', '', root);
  const titleEl = el('span', 'title', header);
  el('span', 'spacer', header);
  const shotEl = el('span', 'shot', header);
  const scaleSel = el('select', 'scale', header);
  for (const s of [0.25, 0.5, 0.75, 1]) {
    const o = el('option', '', scaleSel, `${Math.round(s * 100)}%`);
    o.value = String(s);
    if (s === scale) o.selected = true;
  }
  scaleSel.onchange = () => {
    q.set('s', scaleSel.value);
    location.search = q.toString() + location.hash;
  };
  const statEl = el('span', 'stat', header);

  const stage = el('main', 'stage', root);
  const canvas = el('canvas', '', stage);
  const loading = el('div', 'loading', stage, 'Loading…');

  const footer = el('footer', '', root);
  const transport = el('div', 'transport', footer);
  const prevBtn = el('button', '', transport, '⏮');
  const playBtn = el('button', 'play', transport, '▶');
  const nextBtn = el('button', '', transport, '⏭');
  const timeEl = el('span', 'time', transport);
  const speedSel = el('select', 'speed', transport);
  for (const s of [0.25, 0.5, 1, 2]) {
    const o = el('option', '', speedSel, `${s}×`);
    o.value = String(s);
    if (s === 1) o.selected = true;
  }
  const muteBtn = el('button', '', transport, '🔊');
  const timeline = el('div', 'timeline', footer);
  const playhead = el('div', 'playhead', timeline);

  let project: Project;
  try {
    project = await loadFilm();
  } catch (e) {
    loading.textContent = String(e);
    return;
  }
  titleEl.textContent = project.title;
  document.title = `${project.title} · Preview`;
  const engine = new Engine(canvas, project, {
    width: Math.round(project.width * scale),
    height: Math.round(project.height * scale),
    noMotionBlur: q.get('mb') !== '1',
  });
  try {
    await engine.load((m) => (loading.textContent = `Loading… ${m}`));
  } catch (e) {
    loading.textContent = String(e);
    console.error(e);
    return;
  }
  loading.remove();

  // Timeline: shots as blocks, markers as ticks.
  const D = project.duration;
  project.shots.forEach((s, i) => {
    const b = el('div', `seg seg${i % 2}`, timeline);
    b.style.left = `${(s.start / D) * 100}%`;
    b.style.width = `${((s.end - s.start) / D) * 100}%`;
    b.title = `${s.id}  ${s.start.toFixed(1)}–${s.end.toFixed(1)}s`;
    el('span', '', b, s.id);
  });
  for (const m of project.markers ?? []) {
    const k = el('div', 'marker', timeline);
    k.style.left = `${(m.t / D) * 100}%`;
    k.title = `${m.label} @ ${m.t.toFixed(2)}s`;
  }
  timeline.appendChild(playhead);

  const audio = project.audio ? new Audio(project.audio) : null;
  let audioOk = !!audio;
  audio?.addEventListener('error', () => (audioOk = false));
  let muted = false;

  let time = Number(new URLSearchParams(location.hash.slice(1)).get('t') ?? 0) || 0;
  let playing = false;
  let wall0 = 0, time0 = 0;
  const speed = () => Number(speedSel.value);

  const draw = () => {
    const frame = Math.min(engine.frameCount - 1, Math.max(0, Math.floor(time * project.fps + 1e-6)));
    engine.renderFrame(frame);
    timeEl.textContent = `${fmt(time, project.fps)} / ${fmt(D, project.fps)}`;
    playhead.style.left = `${(time / D) * 100}%`;
    const act = engine.activeShots(time).map((a) => a.shot.id);
    shotEl.textContent = act.join(' + ');
    statEl.textContent = `${engine.width}×${engine.height} · ${engine.lastFrameMs.toFixed(0)} ms`;
  };

  const setTime = (t: number) => {
    time = Math.min(D, Math.max(0, t));
    if (playing) {
      time0 = time;
      wall0 = performance.now();
      if (audio && audioOk) audio.currentTime = time;
    } else history.replaceState(null, '', `#t=${time.toFixed(3)}`);
    draw();
  };

  const play = () => {
    if (playing) return;
    playing = true;
    playBtn.textContent = '❚❚';
    time0 = time >= D - 0.01 ? 0 : time;
    time = time0;
    wall0 = performance.now();
    if (audio && audioOk && !muted && speed() === 1) {
      audio.currentTime = time;
      audio.play().catch(() => (audioOk = false));
    }
    requestAnimationFrame(tick);
  };
  const pause = () => {
    playing = false;
    playBtn.textContent = '▶';
    audio?.pause();
    history.replaceState(null, '', `#t=${time.toFixed(3)}`);
  };
  const tick = () => {
    if (!playing) return;
    if (audio && audioOk && !muted && speed() === 1 && !audio.paused) time = audio.currentTime;
    else time = time0 + ((performance.now() - wall0) / 1000) * speed();
    if (time >= D) {
      time = D;
      draw();
      pause();
      return;
    }
    draw();
    requestAnimationFrame(tick);
  };

  const shotStarts = [...new Set(project.shots.map((s) => s.start))].sort((a, b) => a - b);
  const jump = (dir: 1 | -1) => {
    const eps = 0.05;
    const t = dir > 0 ? shotStarts.find((s) => s > time + eps) : [...shotStarts].reverse().find((s) => s < time - eps);
    if (t !== undefined) setTime(t);
  };

  playBtn.onclick = () => (playing ? pause() : play());
  prevBtn.onclick = () => jump(-1);
  nextBtn.onclick = () => jump(1);
  muteBtn.onclick = () => {
    muted = !muted;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    if (muted) audio?.pause();
    else if (playing && audio && audioOk) {
      audio.currentTime = time;
      audio.play().catch(() => (audioOk = false));
    }
  };
  speedSel.onchange = () => {
    if (playing) {
      pause();
      play();
    }
  };

  let dragging = false;
  const seekFromEvent = (ev: PointerEvent) => {
    const r = timeline.getBoundingClientRect();
    setTime(((ev.clientX - r.left) / r.width) * D);
  };
  timeline.addEventListener('pointerdown', (ev) => {
    dragging = true;
    timeline.setPointerCapture(ev.pointerId);
    seekFromEvent(ev);
  });
  timeline.addEventListener('pointermove', (ev) => dragging && seekFromEvent(ev));
  timeline.addEventListener('pointerup', () => (dragging = false));

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLSelectElement) return;
    const f = 1 / project.fps;
    if (ev.code === 'Space') {
      ev.preventDefault();
      playing ? pause() : play();
    } else if (ev.code === 'ArrowRight') setTime(time + (ev.shiftKey ? 1 : f));
    else if (ev.code === 'ArrowLeft') setTime(time - (ev.shiftKey ? 1 : f));
    else if (ev.code === 'BracketRight' || ev.code === 'PageDown') jump(1);
    else if (ev.code === 'BracketLeft' || ev.code === 'PageUp') jump(-1);
    else if (ev.code === 'Home') setTime(0);
    else if (ev.code === 'End') setTime(D);
    else if (ev.code === 'KeyM') muteBtn.click();
    else if (ev.code === 'KeyF') stage.requestFullscreen?.();
  });

  setTime(time);
}

main();

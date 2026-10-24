// src/scripts/players.ts
// Behaviour for every [data-player] (see src/components/Player.astro).

type PlayerState = {
  root: HTMLElement;
  video: HTMLVideoElement;
  playButton: HTMLButtonElement | null;
  soundButton: HTMLButtonElement | null;
  tape: HTMLElement | null;
  fill: HTMLElement | null;
  title: string;
  userPaused: boolean;
  visible: boolean;
  frame: number;
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const saveData =
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const mayAutoplay = () => !reduceMotion.matches && !saveData;

export function initPlayers() {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-player]'));
  if (!roots.length) return;

  const states = new Map<Element, PlayerState>();

  const render = (s: PlayerState) => {
    const playing = !s.video.paused;
    s.root.classList.toggle('is-playing', playing);
    s.root.classList.toggle('is-unmuted', !s.video.muted);
    s.playButton?.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${s.title}`);
    s.soundButton?.setAttribute('aria-label', s.video.muted ? 'Turn sound on' : 'Turn sound off');
    s.soundButton?.setAttribute('aria-pressed', String(!s.video.muted));
  };

  const drawProgress = (s: PlayerState) => {
    if (!s.fill) return;
    const d = s.video.duration;
    const p = d && Number.isFinite(d) ? s.video.currentTime / d : 0;
    s.fill.style.transform = `scaleX(${p})`;
  };

  const loop = (s: PlayerState) => {
    drawProgress(s);
    s.frame = requestAnimationFrame(() => loop(s));
  };

  const setTape = (s: PlayerState, seconds: number) => {
    if (!s.tape || !Number.isFinite(seconds) || seconds <= 0) return;
    s.tape.style.setProperty('--seconds', String(seconds));
    const hook = Number(s.tape.dataset.hook);
    if (hook > 0) s.tape.style.setProperty('--hook', String(Math.min(hook, seconds)));
  };

  const play = (s: PlayerState) => {
    s.video.play().catch(() => {
      /* Autoplay refused by the browser: the play button still works. */
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const s = states.get(entry.target);
        if (!s) continue;
        s.visible = entry.isIntersecting;
        if (entry.isIntersecting) {
          if (mayAutoplay() && !s.userPaused) play(s);
        } else if (!s.video.paused) {
          s.video.pause();
        }
      }
    },
    { threshold: 0.45 },
  );

  for (const root of roots) {
    const video = root.querySelector('video');
    if (!video) continue;

    video.removeAttribute('controls');
    video.muted = true;

    const s: PlayerState = {
      root,
      video,
      playButton: root.querySelector('[data-play]'),
      soundButton: root.querySelector('[data-sound]'),
      tape: root.querySelector('[data-tape]'),
      fill: root.querySelector('[data-tape-fill]'),
      title: root.dataset.title ?? 'video',
      userPaused: false,
      visible: false,
      frame: 0,
    };
    states.set(root, s);
    setTape(s, Number(s.tape?.dataset.seconds));

    const toggle = () => {
      if (video.paused) {
        s.userPaused = false;
        play(s);
      } else {
        s.userPaused = true;
        video.pause();
      }
    };

    s.playButton?.addEventListener('click', toggle);
    root.querySelector('.player__screen')?.addEventListener('click', toggle);

    s.soundButton?.addEventListener('click', () => {
      const turnOn = video.muted;
      if (turnOn) {
        // Only one ad speaks at a time.
        states.forEach((other) => {
          if (other !== s && !other.video.muted) {
            other.video.muted = true;
            render(other);
          }
        });
      }
      video.muted = !turnOn;
      if (turnOn && video.paused) {
        s.userPaused = false;
        play(s);
      }
      render(s);
    });

    video.addEventListener('loadedmetadata', () => setTape(s, video.duration));
    video.addEventListener('play', () => render(s));
    video.addEventListener('playing', () => {
      cancelAnimationFrame(s.frame);
      loop(s);
    });
    video.addEventListener('pause', () => {
      cancelAnimationFrame(s.frame);
      drawProgress(s);
      render(s);
    });
    video.addEventListener('volumechange', () => render(s));

    const safeZoneButton = root.querySelector<HTMLButtonElement>('[data-safezone]');
    safeZoneButton?.addEventListener('click', () => {
      const on = safeZoneButton.getAttribute('aria-pressed') !== 'true';
      safeZoneButton.setAttribute('aria-pressed', String(on));
      root.classList.toggle('safezone-on', on);
      root.classList.toggle('safezone-off', !on);
    });

    render(s);
    observer.observe(root);
  }

  // Stop everything when the tab is hidden; resume on return if the player is still on screen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      states.forEach((s) => s.video.pause());
    } else if (mayAutoplay()) {
      states.forEach((s) => {
        if (s.visible && !s.userPaused) play(s);
      });
    }
  });
}

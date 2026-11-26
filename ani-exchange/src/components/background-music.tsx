"use client";

import { Music, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const SRC = "/bgm/bgm.mp3";
const VOLUME = 0.3;
const FADE_MS = 1500;
/** "1" = la persona la pausó; no volver a arrancarla sola. */
const STORAGE_KEY = "bgm-paused";

function readPaused(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePaused(paused: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, paused ? "1" : "0");
  } catch {
    // almacenamiento bloqueado: solo no se recuerda
  }
}

/**
 * Música de fondo. Vive en el layout raíz, así que sigue sonando al navegar
 * entre pantallas. Los navegadores no permiten sonido sin interacción, por eso
 * arranca con el primer clic/tecla (salvo que la persona la haya pausado antes).
 */
export function BackgroundMusic() {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const play = async () => {
    const el = audio.current;
    if (!el) return;
    el.volume = 0;
    try {
      await el.play();
    } catch {
      return; // el navegador todavía no lo permite
    }
    // Fade-in suave.
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / FADE_MS);
      el.volume = VOLUME * t;
      if (t < 1 && !el.paused) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // Primer gesto en cualquier parte de la página → empieza (una sola vez).
  useEffect(() => {
    if (readPaused()) return;
    const events = ["pointerdown", "keydown", "touchend"] as const;
    const onFirstGesture = (event: Event) => {
      // El botón de música maneja su propio clic.
      if (event.target instanceof Element && event.target.closest("[data-bgm-toggle]")) return;
      events.forEach((e) => window.removeEventListener(e, onFirstGesture));
      void play();
    };
    events.forEach((e) => window.addEventListener(e, onFirstGesture));
    return () => events.forEach((e) => window.removeEventListener(e, onFirstGesture));
  }, []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      writePaused(false);
      void play();
    } else {
      writePaused(true);
      el.pause();
    }
  };

  return (
    <>
      <audio
        ref={audio}
        src={SRC}
        loop
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        data-bgm-toggle
        onClick={toggle}
        aria-label={playing ? "Pausar música" : "Reproducir música"}
        aria-pressed={playing}
        title={playing ? "Pausar música" : "Reproducir música"}
        className="glass fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-40 flex size-10 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted"
      >
        {playing ? <Music className="size-4 text-festive-green" /> : <VolumeX className="size-4 text-muted-foreground" />}
      </button>
    </>
  );
}

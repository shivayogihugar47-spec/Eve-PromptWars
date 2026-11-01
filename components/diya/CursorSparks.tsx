"use client";

import { useEffect, useRef } from "react";

interface Spark { x: number; y: number; id: number; vx: number; vy: number; life: number; }

export function CursorSparks() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  const nextId = useRef(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    // Disable on mobile and reduced-motion
    if (window.innerWidth < 640) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      for (let k = 0; k < 3; k++) {
        sparks.current.push({
          id: nextId.current++,
          x: e.clientX, y: e.clientY,
          vx: (Math.random() - 0.5) * 2.5,
          vy: (Math.random() - 0.8) * 2.5,
          life: 1,
        });
      }
    };
    window.addEventListener("mousemove", onMove);

    const COLORS = ["#F59E0B", "#FCD34D", "#FBBF24", "#FDE68A"];

    const loop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sparks.current = sparks.current.filter(s => s.life > 0);
      sparks.current.forEach(s => {
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.08;
        s.life -= 0.04;
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = COLORS[s.id % COLORS.length];
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(0, 2.5 * s.life), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[99]"
      aria-hidden
    />
  );
}

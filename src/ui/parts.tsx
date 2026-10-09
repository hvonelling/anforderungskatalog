// Kleine Bausteine, die mehrere Ansichten teilen.

import type { ComponentChildren } from "preact";
import { PRIO, STATUS, type Prio, type Status } from "../domain/types";

export const val = (e: Event) => (e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
export const stop = (e: Event) => e.stopPropagation();

export function PrioBadge({ prio }: { prio: Prio }) {
  return (
    <span class={"prio " + prio} title={PRIO[prio].label}>
      {prio}
    </span>
  );
}

export function StatusDot({ status }: { status: Status }) {
  return <span class={"dot " + status} title={STATUS[status].label} />;
}

export function Check({ done, onToggle, title }: { done: boolean; onToggle: () => void; title?: string }) {
  return (
    <button type="button" class={"check" + (done ? " on" : "")} onClick={onToggle} title={title} aria-pressed={done}>
      {done ? "✓" : ""}
    </button>
  );
}

export function Chip({ on, onClick, children, mono, title }: { on: boolean; onClick: () => void; children: ComponentChildren; mono?: boolean; title?: string }) {
  return (
    <button type="button" class={"chip" + (mono ? " mono" : "") + (on ? " on" : "")} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  return (
    <div class="veil" onClick={onClose}>
      <div class={"dialog" + (wide ? " wide" : "")} onClick={stop} role="dialog" aria-label={title}>
        <div class="dialog-head">
          <span>{title}</span>
          <button type="button" class="icon-btn plain" style="margin-left:auto;font-size:18px" onClick={onClose} title="Schließen (Esc)">
            ×
          </button>
        </div>
        <div class="dialog-body">{children}</div>
      </div>
    </div>
  );
}

export const fmtDateTime = (iso: string | number) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + t.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

export const fmtSize = (n: number) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

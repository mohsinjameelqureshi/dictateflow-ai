import {
  BarChart3,
  BookMarked,
  Mic,
  Settings,
  type LucideIcon,
} from "lucide-react";
import logo from "@/assets/logo.png";
import { Tooltip } from "@/components/ui/tooltip.js";
import { cn } from "@/lib/utils.js";
import type { AppRoute } from "@shared/types.js";

interface Item {
  id: AppRoute;
  label: string;
  icon: LucideIcon;
}

const ITEMS: Item[] = [
  // The route id stays `history` — it is an internal key, and renaming it
  // would churn the shared AppRoute type and the preload bridge for a label.
  { id: "history", label: "Dictation", icon: Mic },
  { id: "dictionary", label: "Dictionary", icon: BookMarked },
  { id: "insights", label: "Insights", icon: BarChart3 },
];

/**
 * One row of the nav, in both widths.
 *
 * Collapsed, the label is the only thing that identifies the destination, so
 * it moves into a tooltip AND into `aria-label` — dropping it from the DOM
 * would leave a screen reader with three unnamed buttons.
 */
function NavButton({
  label,
  icon: Icon,
  active,
  collapsed,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex items-center rounded-lg text-left text-sm transition-colors",
        collapsed ? "size-10 justify-center" : "w-full gap-3 px-3 py-2",
        active
          ? "bg-accent-soft font-medium text-accent"
          : "text-ink-muted hover:bg-line-soft hover:text-ink",
      )}
    >
      <Icon size={16} strokeWidth={2} className="shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  // Expanded, the label is already on screen — a tooltip repeating it is noise.
  return collapsed ? <Tooltip label={label}>{button}</Tooltip> : button;
}

/**
 * §12 — icon + label, subtle active state. The nav list is deliberately short
 * and top-aligned: Snippets and Style get added here later without a redesign.
 *
 * Settings sits apart at the bottom because it is not a destination in this
 * window — it opens a window of its own.
 *
 * Collapsing narrows to an icon rail rather than hiding the nav outright. The
 * destinations stay one click away and the mark stays visible, which is the
 * point of a brand lockup; a hidden sidebar trades that for width the content
 * does not need.
 */
export function Sidebar({
  route,
  collapsed,
  onNavigate,
}: {
  route: AppRoute;
  collapsed: boolean;
  onNavigate: (r: AppRoute) => void;
}) {
  return (
    <nav
      // Referenced by the title bar's toggle via aria-controls.
      id="app-sidebar"
      aria-label="Main"
      className={cn(
        "flex shrink-0 flex-col gap-1 overflow-hidden border-r border-line bg-surface p-3",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-[68px] items-center" : "w-52",
      )}
    >
      {/* The brand lockup: mark, then name. */}
      <div
        className={cn(
          "mb-4 flex h-10 items-center gap-2.5",
          collapsed ? "px-0" : "px-1",
        )}
      >
        <img
          src={logo}
          // Decorative next to the wordmark; the accessible name when the
          // wordmark is not rendered.
          alt={collapsed ? "Wispr AI" : ""}
          draggable={false}
          className="size-7 shrink-0"
        />
        {!collapsed && (
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">
            Wispr AI
          </span>
        )}
      </div>

      {ITEMS.map(({ id, label, icon: Icon }) => (
        <NavButton
          key={id}
          label={label}
          icon={Icon}
          active={route === id}
          collapsed={collapsed}
          onClick={() => onNavigate(id)}
        />
      ))}

      {/* The spacer lives on a wrapper, not the button: collapsed, the button
          is wrapped by the tooltip host and `mt-auto` would land on that. */}
      <div className="mt-auto">
        <NavButton
          label="Settings"
          icon={Settings}
          active={false}
          collapsed={collapsed}
          onClick={() => void window.wispr.settings.open()}
        />
      </div>
    </nav>
  );
}

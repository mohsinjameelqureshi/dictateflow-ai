import {
  BarChart3,
  BookMarked,
  Mic,
  Settings,
  WandSparkles,
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
  { id: "insights", label: "Insights", icon: BarChart3 },
  // Dictionary and Transform are both "rules applied to a transcript", so they
  // sit together below the two destinations that show what was dictated.
  { id: "dictionary", label: "Dictionary", icon: BookMarked },
  { id: "transform", label: "Transform", icon: WandSparkles },
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
        // Neutral, like a ghost button's hover, rather than the indigo it used
        // to carry — but one step deeper than that hover, so it stays legible
        // on the white panel and cannot be confused with a hovered neighbour.
        active
          ? "bg-selected font-medium text-ink"
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
 * Settings sits apart at the bottom because it is not a destination — it opens
 * a dialog over whichever page you are on, and you land back on that page.
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
  onOpenSettings,
}: {
  route: AppRoute;
  collapsed: boolean;
  onNavigate: (r: AppRoute) => void;
  onOpenSettings: () => void;
}) {
  return (
    <nav
      // Referenced by the title bar's toggle via aria-controls.
      id="app-sidebar"
      aria-label="Main"
      className={cn(
        // Its own block on the window ground, not a strip fused to the content
        // — hence a border on all four sides and a radius, with SidebarHandle
        // occupying the gap that separates it from the content.
        "flex shrink-0 flex-col gap-1 overflow-hidden rounded-panel border border-line bg-panel p-3",
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
          alt={collapsed ? "DictateFlow AI" : ""}
          draggable={false}
          className="size-7 shrink-0"
        />
        {!collapsed && (
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">
            DictateFlow AI
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
          // Wrapped, not passed straight through: NavButton hands `onClick` to
          // the DOM, so a bare reference would be invoked with a MouseEvent.
          onClick={() => onOpenSettings()}
        />
      </div>
    </nav>
  );
}

/**
 * The gap between the sidebar block and the content block, as a toggle.
 *
 * It used to be a strip clamped to the sidebar's own right edge. Once the two
 * became separate blocks that edge stopped being the boundary between them —
 * the space between them is. So the handle IS the gap: the whole 8px channel
 * is the hit area, which is a target you can hit without aiming.
 *
 * It must be a sibling of the two blocks rather than a child of either, which
 * is why the row in App.tsx sets no `gap` — this element is the gap.
 *
 * Pointer-only on purpose: `tabIndex={-1}` and `aria-hidden` keep it out of the
 * tab order and the accessibility tree, because it does exactly what the title
 * bar's toggle does and a second identical control is noise to anyone
 * navigating by keyboard or screen reader.
 */
export function SidebarHandle({ onToggle }: { onToggle: () => void }) {
  return (
    // It paints nothing, in any state. The gap is meant to read as space
    // between two blocks; a line appearing under the pointer turns it back into
    // a divider, which is the thing the panelled layout removed. The cursor is
    // the only affordance.
    <button
      type="button"
      onClick={onToggle}
      tabIndex={-1}
      aria-hidden
      className="w-2 shrink-0 cursor-pointer"
    />
  );
}

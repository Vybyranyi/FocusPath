import { Emoji } from "react-apple-emojis";
import { Link } from "react-router";
import type { PlanSummary } from "@shared/index";
import { CompletionStat, PlanBadges } from "@components/explore/PlanBadges";
import { categoryLabel, PLAN_CATEGORY_TINTS, isPlanCategory } from "@/lib/planCategories";
import { languageLabel } from "@/lib/planLanguages";
import { frequencyLabel } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/**
 * One plan in a list.
 *
 * A real link, not a card with an onClick: the whole tile is the target, so it
 * can be opened in a new tab, reached by keyboard and read out as a link — none
 * of which a clickable `<div>` gives you.
 */
export default function PlanCard({ plan }: { plan: PlanSummary }) {
  const tint = isPlanCategory(plan.category)
    ? PLAN_CATEGORY_TINTS[plan.category]
    : "bg-surface-2 text-ink-2";

  return (
    <Link
      to={`/explore/${plan._id}`}
      className={cn(
        "group flex flex-col gap-3 p-4 rounded-2xl bg-surface ring-card text-left",
        "transition-shadow duration-(--duration-base) hover:ring-card-hover",
      )}
    >
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-12 h-12 shrink-0 rounded-2xl bg-canvas flex items-center justify-center">
          <Emoji name={plan.icon || "dart"} className="w-6 h-6" />
        </span>

        <div className="min-w-0 flex flex-col gap-1">
          <h3 className="title text-ink line-clamp-2">{plan.title}</h3>
          <p className="alternative text-ink-2">
            {plan.duration} sessions · {frequencyLabel(plan.frequency)} ·{" "}
            {plan.type === "build" ? "Build" : "Quit"} · {languageLabel(plan.language)}
          </p>
        </div>
      </div>

      {plan.description && (
        <p className="body-light text-ink-2 line-clamp-2">{plan.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("chip px-2 py-1 rounded-full leading-none", tint)}>
          {categoryLabel(plan.category)}
        </span>
        <PlanBadges plan={plan} />
      </div>

      <CompletionStat plan={plan} className="mt-auto" />
    </Link>
  );
}

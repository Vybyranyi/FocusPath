import { useEffect, useState } from "react";
import { Emoji } from "react-apple-emojis";
import { useNavigate, useParams } from "react-router";
import type { ReportReason } from "@shared/index";
import Button from "@components/ui/Button";
import { Skeleton } from "@components/ui/Skeleton";
import { CompletionStat, PlanBadges } from "@components/explore/PlanBadges";
import TakePlanSheet from "@components/explore/TakePlanSheet";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { clearPlan, fetchPlan, reportPlan } from "@store/plansSlice";
import { useToast } from "@hooks/useToast";
import { categoryLabel, PLAN_CATEGORY_TINTS, isPlanCategory } from "@/lib/planCategories";
import { languageLabel } from "@/lib/planLanguages";
import { frequencyLabel, targetLabel } from "@/lib/schedule";
import { cn } from "@/lib/utils";

const REPORT_REASONS: ReadonlyArray<{ value: ReportReason; label: string }> = [
  { value: "dangerous", label: "Unsafe advice" },
  { value: "spam", label: "Spam or advertising" },
  { value: "offensive", label: "Offensive" },
  { value: "nonsense", label: "Not a real plan" },
  { value: "other", label: "Something else" },
];

/**
 * One plan, in full or as a teaser.
 *
 * Which of the two arrives is the server's decision, and this page reads it off
 * `daysTruncated` rather than off the session — one endpoint, two shapes. A
 * visitor with no account sees the plan's shape and its first days; the rest is
 * behind registration, not behind the feature.
 */
export default function PlanDetailPage() {
  const { id = "" } = useParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { notify } = useToast();

  const plan = useAppSelector((state) => state.plans.plan);
  const loading = useAppSelector((state) => state.plans.planLoading);
  const error = useAppSelector((state) => state.plans.error);
  const user = useAppSelector((state) => state.auth.user);

  const [taking, setTaking] = useState(false);
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    dispatch(fetchPlan(id));
    // Cleared on the way out, so the next plan never flashes the previous one.
    return () => {
      dispatch(clearPlan());
    };
  }, [dispatch, id]);

  const handleReport = async (reason: ReportReason) => {
    setReporting(false);
    try {
      await dispatch(reportPlan({ planId: id, reason })).unwrap();
      notify("Thanks — a moderator will look at this plan");
    } catch {
      notify("Could not send that report");
    }
  };

  if (loading && !plan) {
    return (
      <div className="page-gutter max-w-3xl mx-auto pt-6 md:pt-10 pb-28 flex flex-col gap-4">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="page-gutter max-w-3xl mx-auto pt-10 pb-28 flex flex-col items-center text-center gap-4">
        <h1 className="display-5 text-ink">This plan is not available</h1>
        <p className="body-light text-ink-2 max-w-80">
          {error ?? "It may have been withdrawn by its author."}
        </p>
        <div className="w-full max-w-64">
          <Button type="primary" size="medium" onClick={() => navigate("/explore")}>
            Back to Explore
          </Button>
        </div>
      </div>
    );
  }

  const tint = isPlanCategory(plan.category)
    ? PLAN_CATEGORY_TINTS[plan.category]
    : "bg-surface-2 text-ink-2";

  return (
    <div className="page-gutter max-w-3xl mx-auto pt-6 md:pt-10 pb-28 md:pb-12 flex flex-col gap-6">
      <div className="flex items-start gap-4">
        <span className="w-16 h-16 shrink-0 rounded-2xl bg-surface flex items-center justify-center">
          <Emoji name={plan.icon || "dart"} className="w-8 h-8" />
        </span>

        <div className="min-w-0 flex flex-col gap-2">
          <h1 className="display-4 text-ink">{plan.title}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("chip px-2 py-1 rounded-full leading-none", tint)}>
              {categoryLabel(plan.category)}
            </span>
            <span className="chip px-2 py-1 rounded-full leading-none bg-surface-2 text-ink-2">
              {plan.duration} sessions
            </span>
            <span className="chip px-2 py-1 rounded-full leading-none bg-surface-2 text-ink-2">
              {frequencyLabel(plan.frequency)}
              {plan.target ? ` · ${targetLabel(plan.target)}` : ""}
            </span>
            <span className="chip px-2 py-1 rounded-full leading-none bg-surface-2 text-ink-2">
              {plan.type === "build" ? "Build" : "Quit"}
            </span>
            <span className="chip px-2 py-1 rounded-full leading-none bg-surface-2 text-ink-2">
              {languageLabel(plan.language)}
            </span>
            <PlanBadges plan={plan} />
          </div>
        </div>
      </div>

      {plan.description && (
        <p className="body-light text-ink-2 leading-relaxed whitespace-pre-wrap">
          {plan.description}
        </p>
      )}

      <div className="flex flex-col gap-2 p-4 rounded-2xl bg-surface ring-card">
        <CompletionStat plan={plan} />
        <p className="alternative text-ink-muted">
          {/* Never the author's own streak or percentage — someone signed up for
              a habit tracker, not a public profile. */}
          {plan.author.displayName
            ? `Published by ${plan.author.displayName}`
            : "Published anonymously"}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="display-5 text-ink">Day by day</h2>

        <ol className="flex flex-col gap-2">
          {plan.days.map((day, index) => (
            <li
              key={`${index}-${day.dayTitle}`}
              className="flex items-start gap-3 p-3 rounded-2xl bg-surface ring-card"
            >
              <span className="chip w-8 h-8 shrink-0 rounded-full bg-canvas text-ink-2 flex items-center justify-center">
                {index + 1}
              </span>
              <span className="body-light text-ink pt-1.5">{day.dayTitle}</span>
            </li>
          ))}
        </ol>

        {plan.daysTruncated && (
          <div className="flex flex-col items-center text-center gap-3 p-6 rounded-2xl bg-accent-soft">
            <p className="body-bold text-ink">
              {plan.duration - plan.days.length} more sessions are written and waiting
            </p>
            <p className="alternative text-ink-2 max-w-80">
              Create an account to read the whole plan before you commit to it —
              and to take it in one tap.
            </p>
            <div className="w-full max-w-64 flex flex-col gap-2">
              <Button type="primary" size="medium" onClick={() => navigate("/register")}>
                Create an account
              </Button>
              <Button type="outline" size="medium" onClick={() => navigate("/login")}>
                I already have one
              </Button>
            </div>
          </div>
        )}
      </div>

      {user && (
        <div className="flex flex-col gap-3">
          <Button type="primary" size="large" onClick={() => setTaking(true)}>
            Take this plan
          </Button>

          {reporting ? (
            <div
              role="group"
              aria-label="Report this plan"
              className="flex flex-col gap-2 p-4 rounded-2xl bg-surface ring-card"
            >
              <p className="field-label text-ink-2">What is wrong with it?</p>
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason.value}
                  type="button"
                  onClick={() => handleReport(reason.value)}
                  className="min-h-11 px-3 rounded-xl text-left body-light text-ink hover:bg-canvas transition-colors duration-(--duration-fast) cursor-pointer"
                >
                  {reason.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setReporting(false)}
                className="min-h-11 px-3 rounded-xl text-left alternative text-ink-muted hover:bg-canvas transition-colors duration-(--duration-fast) cursor-pointer"
              >
                Never mind
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="min-h-11 alternative text-ink-muted hover:text-ink transition-colors duration-(--duration-fast) cursor-pointer"
            >
              Report this plan
            </button>
          )}
        </div>
      )}

      {user && <TakePlanSheet plan={plan} open={taking} onOpenChange={setTaking} />}
    </div>
  );
}

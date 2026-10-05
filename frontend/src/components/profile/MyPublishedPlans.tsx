import { useEffect } from "react";
import { Link } from "react-router";
import { CompletionStat, PlanBadges } from "@components/explore/PlanBadges";
import { Skeleton } from "@components/ui/Skeleton";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { fetchMyPlans, unpublishPlan } from "@store/plansSlice";
import { selectMyPlans } from "@store/selectors";
import { useToast } from "@hooks/useToast";
import { categoryLabel } from "@/lib/planCategories";

/**
 * What became of the plans you published.
 *
 * This is the minimum the feature owes an author, not a courtesy. Publishing is
 * otherwise write-only: anonymous by default, no author statistics in public,
 * and no notifications anywhere in this app — so without this page there is no
 * way at all to learn that a plan of yours helped anyone.
 *
 * Opening it is also the second of the two lazy triggers for the proven badge:
 * someone who stopped marking days on day 85 never fires the first one, and
 * their plan may still have earned it.
 */
export default function MyPublishedPlans() {
  const dispatch = useAppDispatch();
  const { notify } = useToast();
  const plans = useAppSelector(selectMyPlans);
  const loading = useAppSelector((state) => state.plans.myPlansLoading);

  useEffect(() => {
    dispatch(fetchMyPlans());
  }, [dispatch]);

  const handleWithdraw = async (planId: string, title: string) => {
    try {
      await dispatch(unpublishPlan(planId)).unwrap();
      notify(`“${title}” is no longer in the library`);
    } catch {
      notify("Could not withdraw that plan");
    }
  };

  return (
    <section className="bg-surface rounded-2xl shadow-lifted p-6 flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="title font-bold">Published plans</h2>
        <p className="alternative text-ink-muted">
          Only you can see this. Nothing here is shown next to your plans.
        </p>
      </div>

      {loading && plans.length === 0 && <Skeleton className="h-20 rounded-2xl" />}

      {!loading && plans.length === 0 && (
        <p className="body-light text-ink-2">
          You have not published anything yet. Open a habit and choose{" "}
          <span className="body-bold">Publish as a plan</span> to put it in the
          library.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {plans.map((plan) => (
          <li
            key={plan._id}
            className="flex flex-col gap-2 p-4 rounded-2xl bg-canvas border border-line"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-1">
                {plan.status === "published" ? (
                  <Link to={`/explore/${plan._id}`} className="body-bold text-ink">
                    {plan.title}
                  </Link>
                ) : (
                  <span className="body-bold text-ink-2">{plan.title}</span>
                )}
                <span className="alternative text-ink-muted">
                  {categoryLabel(plan.category)} · {plan.duration} sessions
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <PlanBadges plan={plan} />
                {plan.status !== "published" && (
                  <span className="chip px-2 py-1 rounded-full leading-none bg-surface-2 text-ink-2">
                    {plan.status === "unpublished" ? "Withdrawn" : "Removed"}
                  </span>
                )}
              </div>
            </div>

            <CompletionStat plan={plan} />

            {plan.status === "published" && (
              <button
                type="button"
                onClick={() => handleWithdraw(plan._id, plan.title)}
                className="self-start min-h-11 alternative text-ink-muted hover:text-danger transition-colors duration-(--duration-fast) cursor-pointer"
              >
                Withdraw from the library
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

import AILoadingAnimation from "@animation/AILoadingAnimation";
import Button from "@components/ui/Button";
import CategoryPicker from "@components/pickers/CategoryPicker";
import ColorPicker from "@components/pickers/ColorPicker";
import DurationPicker from "@components/pickers/DurationPicker";
import EmojiPicker from "@components/pickers/EmojiPicker";
import HabitTypePicker from "@components/pickers/HabitTypePicker";
import ScheduleFields from "@components/pickers/ScheduleFields";
import Input from "@components/ui/Input";
import WeekDatePicker from "@components/pickers/WeekDatePicker";
import StepsEditor from "@components/habit/StepsEditor";
import { STEP_TITLE_MAX } from "@/lib/steps";
import { DEFAULT_SCHEDULE, scheduleProblems } from "@/lib/schedule";
import { createAIHabit, createHabit } from "@store/habitSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { Form, Formik } from "formik";
import { useNavigate } from "react-router";
import { useRef } from "react";
import * as Yup from "yup";
import type { CreateHabitFormValues } from "@/types/forms";

const validationSchema = Yup.object({
  color: Yup.string().required("Color is required"),
  emoji: Yup.string().required("Emoji is required"),
  // The server's own limits. The form asked for 5–20 characters, so "Read",
  // "Run" and "Yoga" were refused before they were ever sent, and a
  // description the API treats as optional was demanded at ten characters.
  habitName: Yup.string()
    .trim()
    .max(100, "Must be 100 characters or fewer")
    .required("Habit name is required"),
  habitDescription: Yup.string().trim().max(500, "Must be 500 characters or fewer"),
  startDate: Yup.date()
    .nullable()
    .required("Start date is required")
    .test("not-past", "Start date cannot be in the past", (value) => {
      if (!value) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sel = new Date(value);
      sel.setHours(0, 0, 0, 0);
      return sel >= today;
    }),
  autoDuration: Yup.boolean(),
  noEnd: Yup.boolean(),
  // Needed only when there is a programme to size: not for a habit with no end,
  // and not when the AI is choosing.
  duration: Yup.string().when(["autoDuration", "noEnd"], {
    is: (autoDuration: boolean, noEnd: boolean) => !autoDuration && !noEnd,
    then: (s) =>
      s
        .required("Number of sessions is required")
        .matches(/^\d+$/, "Must be a number")
        .test("range", "Must be 1–365 sessions", (v) => {
          const n = parseInt(v ?? "");
          return n >= 1 && n <= 365;
        }),
    otherwise: (s) => s.notRequired(),
  }),
  // The same checks the edit sheet and the take-a-plan sheet make, from one
  // place, reported as one error per field.
  // `mixed`, not `object`: an object schema with no shape would cast the draft
  // down to an empty one before the test ever saw it.
  schedule: Yup.mixed().test("schedule", "Check the schedule", (value, context) => {
    const problems = scheduleProblems(value as CreateHabitFormValues["schedule"]);
    const first = Object.entries(problems)[0];
    return first
      ? context.createError({ path: `schedule.${first[0]}`, message: first[1] })
      : true;
  }),
  steps: Yup.array().of(
    Yup.object({ title: Yup.string().max(STEP_TITLE_MAX, `Each step must be ${STEP_TITLE_MAX} characters or fewer`) }),
  ),
  habitType: Yup.string()
    .oneOf(["build", "quit"])
    .required("Habit type is required"),
});

/** Formik reports a nested object's errors as an object; the fields want a flat shape. */
const scheduleErrors = (errors: unknown) =>
  typeof errors === "object" && errors !== null
    ? (errors as Record<string, string>)
    : {};

const initialValues: CreateHabitFormValues = {
  color: "",
  emoji: "",
  habitName: "",
  habitDescription: "",
  category: "",
  steps: [],
  startDate: new Date(),
  autoDuration: false,
  duration: "",
  noEnd: false,
  schedule: DEFAULT_SCHEDULE,
  habitType: "build",
};

export default function CreateHabit() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const error = useAppSelector((state) => state.habit.error);
  // Which creation is running, rather than one flag for both: the shared flag
  // put "Creating..." on whichever button the user had not pressed.
  const creating = useAppSelector((state) => state.habit.creating);

  /**
   * Which button submitted the form. Kept out of the form's values on purpose:
   * it used to be the same `aiEnabled` flag as the "let AI choose the number of
   * days" switch, so pressing "Create by AI" flipped that switch on, hid the
   * days field while still sending what was in it, and left "Create" disabled
   * after a failed AI attempt. Set from the click, it was also racing Formik's
   * own validation of the submit it triggered.
   */
  const intent = useRef<"manual" | "ai">("manual");

  const handleSubmit = async (values: CreateHabitFormValues) => {
    try {
      await dispatch(
        intent.current === "ai" ? createAIHabit(values) : createHabit(values),
      ).unwrap();
      navigate("/main");
    } catch {
      // The reason is already in the store and rendered under the form.
    }
  };

  return (
    <>
      {creating === "ai" && <AILoadingAnimation />}

      <div className="page-gutter">
        <h1 className="display-5 hidden md:block mb-4">Create Habit</h1>

        <Formik
          initialValues={initialValues}
          validationSchema={validationSchema}
          onSubmit={handleSubmit}
        >
          {({
            values,
            errors,
            touched,
            handleChange,
            handleBlur,
            setFieldValue,
            setFieldTouched,
          }) => (
            <Form>
              <div
                className={[
                  "flex flex-col gap-4 pt-2 pb-28",
                  "md:grid md:grid-cols-2 md:gap-x-6 md:pt-4 md:pb-0 md:items-start",
                ].join(" ")}
              >
                <div className="flex flex-col gap-4">
                  <ColorPicker
                    value={values.color}
                    error={touched.color ? errors.color : ""}
                    onChange={(v) => handleChange("color")(v)}
                  />
                  <EmojiPicker
                    value={values.emoji}
                    error={touched.emoji ? errors.emoji : ""}
                    onChange={(v) => handleChange("emoji")(v)}
                  />
                  <Input
                    label="Habit name"
                    placeholder="Enter Habit Name"
                    type="text"
                    value={values.habitName}
                    onChange={handleChange("habitName")}
                    onClear={() => handleChange("habitName")("")}
                    onBlur={handleBlur("habitName")}
                    error={touched.habitName ? errors.habitName : ""}
                  />
                  <Input
                    label="Habit description (optional)"
                    placeholder="Describe your habit"
                    type="text"
                    value={values.habitDescription}
                    onChange={handleChange("habitDescription")}
                    onClear={() => handleChange("habitDescription")("")}
                    onBlur={handleBlur("habitDescription")}
                    error={
                      touched.habitDescription ? errors.habitDescription : ""
                    }
                  />
                  <p className="alternative text-ink-muted">
                    Provide more details about your habit to help the AI generate a better personalized plan.
                  </p>
                  {/* Optional here, required only if this habit is ever
                      published as a plan — but asked for now, because a habit
                      with no category has nothing to offer the library later. */}
                  <CategoryPicker
                    value={values.category}
                    onChange={(value) => setFieldValue("category", value)}
                  />
                  <StepsEditor
                    steps={values.steps}
                    onChange={(steps) => setFieldValue("steps", steps)}
                  />
                </div>

                <div className="flex flex-col gap-4">
                  <WeekDatePicker
                    label="Start date"
                    selectedDate={values.startDate}
                    onDateSelect={(date) => {
                      setFieldValue("startDate", date, true);
                      setFieldTouched("startDate", true, false);
                    }}
                    error={touched.startDate ? errors.startDate : ""}
                  />
                  <ScheduleFields
                    value={values.schedule}
                    type={values.habitType}
                    problems={scheduleErrors(errors.schedule)}
                    onChange={(next) => setFieldValue("schedule", next)}
                  />
                  <DurationPicker
                    autoDuration={values.autoDuration}
                    noEnd={values.noEnd}
                    duration={values.duration}
                    onNoEndToggle={() => {
                      setFieldValue("noEnd", !values.noEnd);
                      // A habit with no end has nothing for the AI to write.
                      if (!values.noEnd) setFieldValue("autoDuration", false);
                    }}
                    onAiToggle={() => {
                      setFieldValue("autoDuration", !values.autoDuration);
                      if (!values.autoDuration) {
                        setFieldValue("duration", "");
                        setFieldTouched("duration", false);
                      }
                    }}
                    onDurationChange={(e) =>
                      setFieldValue("duration", e.target.value)
                    }
                    onDurationBlur={() => setFieldTouched("duration", true)}
                    error={touched.duration ? errors.duration : ""}
                  />
                  <HabitTypePicker
                    value={values.habitType}
                    onSelect={(type) => {
                      setFieldValue("habitType", type);
                      setFieldTouched("habitType", true);
                    }}
                    error={touched.habitType ? errors.habitType : ""}
                  />

                  <div
                    className={[
                      "fixed bottom-3 left-6 right-6 flex gap-4",
                      "md:static md:mt-4 md:pb-4",
                    ].join(" ")}
                  >
                    <Button
                      type="primary"
                      size="large"
                      htmlType="submit"
                      disabled={creating !== null || values.autoDuration}
                      onClick={() => { intent.current = "manual"; }}
                    >
                      {creating === "manual" ? "Creating..." : "Create"}
                    </Button>
                    <Button
                      type="ai"
                      size="large"
                      htmlType="submit"
                      disabled={creating !== null || values.noEnd}
                      onClick={() => { intent.current = "ai"; }}
                    >
                      {creating === "ai" ? "Creating..." : "Create by AI"}
                    </Button>
                  </div>

                  {values.autoDuration && creating === null && (
                    <p className="alternative text-ink-muted mt-1">
                      Only the AI can pick the number of sessions. Turn the switch
                      off to create this habit yourself.
                    </p>
                  )}
                  {values.noEnd && creating === null && (
                    <p className="alternative text-ink-muted mt-1">
                      A habit with no end has no programme, so there is nothing
                      for the AI to write. It also cannot be published as a plan.
                    </p>
                  )}
                  {creating !== null && (
                    <p className="alternative text-ink-muted mt-1">
                      Creating habit...
                    </p>
                  )}
                  {error && (
                    <p className="alternative text-danger mt-1">{error}</p>
                  )}
                </div>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </>
  );
}

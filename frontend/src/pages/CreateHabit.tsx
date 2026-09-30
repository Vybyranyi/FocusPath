import AILoadingAnimation from "@animation/AILoadingAnimation";
import Button from "@components/ui/Button";
import CategoryPicker from "@components/pickers/CategoryPicker";
import ColorPicker from "@components/pickers/ColorPicker";
import DurationPicker from "@components/pickers/DurationPicker";
import EmojiPicker from "@components/pickers/EmojiPicker";
import HabitTypePicker from "@components/pickers/HabitTypePicker";
import Input from "@components/ui/Input";
import WeekDatePicker from "@components/pickers/WeekDatePicker";
import StepsEditor from "@components/habit/StepsEditor";
import { STEP_TITLE_MAX } from "@/lib/steps";
import { createAIHabit, createHabit } from "@store/habitSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { Form, Formik } from "formik";
import { useNavigate } from "react-router";
import * as Yup from "yup";
import type { CreateHabitFormValues } from "@/types/forms";

const validationSchema = Yup.object({
  color: Yup.string().required("Color is required"),
  emoji: Yup.string().required("Emoji is required"),
  habitName: Yup.string().min(5).max(20).required("Habit name is required"),
  habitDescription: Yup.string()
    .min(10)
    .max(100)
    .required("Habit description is required"),
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
  aiEnabled: Yup.boolean(),
  duration: Yup.string().when("aiEnabled", {
    is: false,
    then: (s) =>
      s
        .required("Duration is required")
        .matches(/^\d+$/, "Must be a number")
        .test("range", "Must be 1–365 days", (v) => {
          const n = parseInt(v ?? "");
          return n >= 1 && n <= 365;
        }),
    otherwise: (s) => s.notRequired(),
  }),
  steps: Yup.array().of(
    Yup.object({ title: Yup.string().max(STEP_TITLE_MAX, `Each step must be ${STEP_TITLE_MAX} characters or fewer`) }),
  ),
  habitType: Yup.string()
    .oneOf(["build", "quit"])
    .required("Habit type is required"),
});

const initialValues: CreateHabitFormValues = {
  color: "",
  emoji: "",
  habitName: "",
  habitDescription: "",
  category: "",
  steps: [],
  startDate: new Date(),
  aiEnabled: false,
  duration: "",
  habitType: "build",
};

export default function CreateHabit() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const error = useAppSelector((state) => state.habit.error);
  // Which creation is running, rather than one flag for both: the shared flag
  // put "Creating..." on whichever button the user had not pressed.
  const creating = useAppSelector((state) => state.habit.creating);

  const handleSubmit = async (values: CreateHabitFormValues) => {
    try {
      await dispatch(
        values.aiEnabled ? createAIHabit(values) : createHabit(values),
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
                    label="Habit description"
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
                  <DurationPicker
                    aiEnabled={values.aiEnabled}
                    duration={values.duration}
                    onAiToggle={() => {
                      setFieldValue("aiEnabled", !values.aiEnabled);
                      if (!values.aiEnabled) {
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
                      disabled={creating !== null || values.aiEnabled}
                      onClick={() => setFieldValue("aiEnabled", false)}
                    >
                      {creating === "manual" ? "Creating..." : "Create"}
                    </Button>
                    <Button
                      type="ai"
                      size="large"
                      htmlType="submit"
                      disabled={creating !== null}
                      onClick={() => setFieldValue("aiEnabled", true)}
                    >
                      {creating === "ai" ? "Creating..." : "Create by AI"}
                    </Button>
                  </div>

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

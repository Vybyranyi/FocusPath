import { Request, Response } from 'express';
import * as habitService from '@services/habitService';
import * as journalService from '@services/journalService';
import { created, ok } from '@utils/apiResponse';
import { UnauthorizedError } from '@errors/AppError';
import { startOfUtcDay } from '@utils/dates';
import type { TypedRequest } from '@middlewares/validate';
import type {
    AddPauseDto,
    AddRestDayDto,
    CreateHabitDto,
    CreateHabitFromPlanDto,
    DayNoteParams,
    EndPauseDto,
    HabitParams,
    MarkCompletionDto,
    PauseParams,
    RestDayParams,
    SetNoteDto,
    SetReasonDto,
    SetValueDto,
    StepParams,
    ToggleStepDto,
    UpdateHabitDto,
    UpdateSessionTitleDto,
} from '@validation/habitSchemas';

// Handlers translate HTTP into a service call and back. Ownership, scheduling
// and progress live in habitService; shape and types live in the schemas.

/** Every route here runs behind verifyTokenMiddleware, so this should always hold. */
const requireUserId = (req: Request): string => {
    if (!req.userId) {
        throw new UnauthorizedError();
    }
    return req.userId;
};

export const createHabit = async (req: TypedRequest<CreateHabitDto>, res: Response) =>
    created(res, { habit: await habitService.createHabit(requireUserId(req), req.body) });

export const createHabitFromPlan = async (
    req: TypedRequest<CreateHabitFromPlanDto>,
    res: Response,
) =>
    created(res, {
        habit: await habitService.createHabitFromPlan(requireUserId(req), req.body),
        fromPlan: true,
    });

export const getHabitsForDate = async (req: Request, res: Response) => {
    // Read from req.query rather than a validated copy: Express 5 silently
    // discards an assignment to it, so the schema checks and the handler parses.
    const { date, today } = req.query;
    const targetDate = startOfUtcDay(typeof date === 'string' && date ? date : new Date());

    const userId = requireUserId(req);

    return ok(res, {
        date: targetDate,
        // The day's own entry rides along, so the day view needs no second request.
        journal: await journalService.getEntry(userId, targetDate),
        habits: await habitService.getHabitsForDate(
            userId,
            targetDate,
            typeof today === 'string' && today ? new Date(today) : undefined,
        ),
    });
};

export const getAllHabits = async (req: Request, res: Response) =>
    ok(res, { habits: await habitService.listHabits(requireUserId(req)) });

export const getHabitById = async (req: TypedRequest<unknown, HabitParams>, res: Response) =>
    ok(res, { habit: await habitService.getHabit(requireUserId(req), req.params.id) });

export const updateHabit = async (
    req: TypedRequest<UpdateHabitDto, HabitParams>,
    res: Response,
) => ok(res, { habit: await habitService.updateHabit(requireUserId(req), req.params.id, req.body) });

export const deleteHabit = async (req: TypedRequest<unknown, HabitParams>, res: Response) => {
    await habitService.deleteHabit(requireUserId(req), req.params.id);
    return ok(res, { habitId: req.params.id });
};

export const updateSessionTitle = async (
    req: TypedRequest<UpdateSessionTitleDto, HabitParams>,
    res: Response,
) =>
    ok(res, {
        habit: await habitService.setSessionTitle(requireUserId(req), req.params.id, req.body),
    });

export const markHabitCompletion = async (
    req: TypedRequest<MarkCompletionDto, HabitParams>,
    res: Response,
) => ok(res, await habitService.markCompletion(requireUserId(req), req.params.id, req.body));

export const setHabitValue = async (
    req: TypedRequest<SetValueDto, HabitParams>,
    res: Response,
) => ok(res, await habitService.setValue(requireUserId(req), req.params.id, req.body));

export const toggleStep = async (req: TypedRequest<ToggleStepDto, StepParams>, res: Response) => {
    const { id, stepId } = req.params;
    const result = await habitService.toggleStep(requireUserId(req), id, stepId, req.body);

    return ok(res, { stepId, ...result });
};

export const addPause = async (req: TypedRequest<AddPauseDto, HabitParams>, res: Response) =>
    created(res, { habit: await habitService.addPause(requireUserId(req), req.params.id, req.body) });

export const endPause = async (req: TypedRequest<EndPauseDto, PauseParams>, res: Response) =>
    ok(res, {
        habit: await habitService.endPause(requireUserId(req), req.params.id, req.params.pauseId, req.body),
    });

export const removePause = async (req: TypedRequest<unknown, PauseParams>, res: Response) =>
    ok(res, {
        habit: await habitService.removePause(requireUserId(req), req.params.id, req.params.pauseId),
    });

export const addRestDay = async (req: TypedRequest<AddRestDayDto, HabitParams>, res: Response) =>
    created(res, { habit: await habitService.addRestDay(requireUserId(req), req.params.id, req.body) });

export const removeRestDay = async (req: TypedRequest<unknown, RestDayParams>, res: Response) =>
    ok(res, {
        habit: await habitService.removeRestDay(requireUserId(req), req.params.id, new Date(req.params.date)),
    });

export const setDayNote = async (req: TypedRequest<SetNoteDto, DayNoteParams>, res: Response) =>
    ok(res, await habitService.setNote(requireUserId(req), req.params.id, req.params.day, req.body));

export const setDayReason = async (req: TypedRequest<SetReasonDto, DayNoteParams>, res: Response) =>
    ok(res, await habitService.setReason(requireUserId(req), req.params.id, req.params.day, req.body));

import { Request, Response } from 'express';
import * as habitService from '@services/habitService';
import { created, ok } from '@utils/apiResponse';
import { UnauthorizedError } from '@errors/AppError';
import { startOfUtcDay } from '@utils/dates';
import type { TypedRequest } from '@middlewares/validate';
import type {
    CreateHabitDto,
    CreateHabitFromPlanDto,
    HabitParams,
    MarkCompletionDto,
    StepParams,
    ToggleStepDto,
    UpdateDayTitleDto,
    UpdateHabitDto,
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
    const { date } = req.query;
    const targetDate = startOfUtcDay(typeof date === 'string' && date ? date : new Date());

    return ok(res, {
        date: targetDate,
        habits: await habitService.getHabitsForDate(requireUserId(req), targetDate),
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

export const updateDayTitle = async (
    req: TypedRequest<UpdateDayTitleDto, HabitParams>,
    res: Response,
) => ok(res, { habit: await habitService.setDayTitle(requireUserId(req), req.params.id, req.body) });

export const markHabitCompletion = async (
    req: TypedRequest<MarkCompletionDto, HabitParams>,
    res: Response,
) =>
    ok(res, {
        habit: await habitService.markCompletion(requireUserId(req), req.params.id, req.body),
    });

export const toggleStep = async (req: TypedRequest<ToggleStepDto, StepParams>, res: Response) => {
    const { id, stepId } = req.params;
    const { habit, completed } = await habitService.toggleStep(requireUserId(req), id, stepId, req.body);

    return ok(res, { stepId, completed, habit });
};

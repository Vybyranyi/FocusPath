import { Request, Response } from 'express';
import * as coachService from '@services/coachService';
import { ok } from '@utils/apiResponse';
import { UnauthorizedError } from '@errors/AppError';
import type { TypedRequest } from '@middlewares/validate';
import { DEFAULT_CARDS, MAX_CARDS, type CardParams, type FeedbackDto } from '@validation/coachSchemas';

const requireUserId = (req: Request): string => {
    if (!req.userId) {
        throw new UnauthorizedError();
    }
    return req.userId;
};

export const refreshCoach = async (req: Request, res: Response) =>
    ok(res, { cards: await coachService.refresh(requireUserId(req)) });

export const listCoachCards = async (req: Request, res: Response) => {
    const { limit, before } = req.query as { limit?: string; before?: string };
    const wanted = limit ? Number(limit) : DEFAULT_CARDS;

    return ok(
        res,
        await coachService.listCards(requireUserId(req), {
            limit: Math.min(Math.max(wanted, 1), MAX_CARDS),
            before: before ? new Date(before) : undefined,
        }),
    );
};

export const openCoachCard = async (req: TypedRequest<unknown, CardParams>, res: Response) =>
    ok(res, { card: await coachService.openCard(requireUserId(req), req.params.id) });

export const applyCoachCard = async (req: TypedRequest<unknown, CardParams>, res: Response) =>
    ok(res, await coachService.applyCard(requireUserId(req), req.params.id));

export const dismissCoachCard = async (req: TypedRequest<unknown, CardParams>, res: Response) =>
    ok(res, { card: await coachService.dismissCard(requireUserId(req), req.params.id) });

export const rateCoachCard = async (req: TypedRequest<FeedbackDto, CardParams>, res: Response) =>
    ok(res, { card: await coachService.giveFeedback(requireUserId(req), req.params.id, req.body.helpful) });

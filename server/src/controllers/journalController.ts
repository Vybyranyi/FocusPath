import { Request, Response } from 'express';
import * as journalService from '@services/journalService';
import { ok } from '@utils/apiResponse';
import { UnauthorizedError } from '@errors/AppError';
import type { TypedRequest } from '@middlewares/validate';
import type { JournalDayParams, PutJournalDto } from '@validation/journalSchemas';

const requireUserId = (req: Request): string => {
    if (!req.userId) {
        throw new UnauthorizedError();
    }
    return req.userId;
};

export const putJournalEntry = async (
    req: TypedRequest<PutJournalDto, JournalDayParams>,
    res: Response,
) =>
    ok(res, {
        entry: await journalService.putEntry(requireUserId(req), req.params.day, req.body),
    });

export const deleteJournalEntry = async (
    req: TypedRequest<unknown, JournalDayParams>,
    res: Response,
) => {
    await journalService.deleteEntry(requireUserId(req), req.params.day);
    return ok(res, { day: req.params.day });
};

export const listJournalEntries = async (req: Request, res: Response) => {
    // Read from `req.query`: Express 5 discards an assignment to it, so the
    // schema checks and the handler reads the strings itself.
    const { from, to } = req.query as { from: string; to: string };
    return ok(res, { entries: await journalService.listEntries(requireUserId(req), from, to) });
};

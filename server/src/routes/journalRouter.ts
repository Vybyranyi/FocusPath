import { Router } from 'express';
import {
    deleteJournalEntry,
    listJournalEntries,
    putJournalEntry,
} from '@controllers/journalController';
import { verifyTokenMiddleware } from '@middlewares/auth';
import { validate } from '@middlewares/validate';
import {
    journalDayParamsSchema,
    journalRangeQuerySchema,
    putJournalSchema,
} from '@validation/journalSchemas';

const router = Router();

// Записи за проміжок (для історії), до 92 днів
router.get('/', verifyTokenMiddleware, validate({ query: journalRangeQuerySchema }), listJournalEntries);

// Запис дня: створити або замінити; порожній — прибрати
router.put('/:day', verifyTokenMiddleware, validate({ params: journalDayParamsSchema, body: putJournalSchema }), putJournalEntry);
router.delete('/:day', verifyTokenMiddleware, validate({ params: journalDayParamsSchema }), deleteJournalEntry);

export default router;

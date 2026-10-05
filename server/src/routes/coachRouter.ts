import { Router } from 'express';
import {
    applyCoachCard,
    dismissCoachCard,
    listCoachCards,
    openCoachCard,
    rateCoachCard,
    refreshCoach,
} from '@controllers/coachController';
import { verifyTokenMiddleware } from '@middlewares/auth';
import { coachLimiter } from '@middlewares/rateLimit';
import { validate } from '@middlewares/validate';
import { cardParamsSchema, cardsQuerySchema, feedbackSchema } from '@validation/coachSchemas';

const router = Router();

// Ліміт після авторизації — ключ рахується по користувачу. Це лише захист від
// зациклених клієнтів: справжній ліміт коуча — унікальність картки за період.
router.use(verifyTokenMiddleware, coachLimiter);

// Сказати те, що «настало»: огляд, пропозиції, інсайт. Без нового — нічого не коштує
router.post('/refresh', refreshCoach);

// Історія карток
router.get('/cards', validate({ query: cardsQuerySchema }), listCoachCards);

router.post('/cards/:id/open', validate({ params: cardParamsSchema }), openCoachCard);
router.post('/cards/:id/apply', validate({ params: cardParamsSchema }), applyCoachCard);
router.post('/cards/:id/dismiss', validate({ params: cardParamsSchema }), dismissCoachCard);
router.post('/cards/:id/feedback', validate({ params: cardParamsSchema, body: feedbackSchema }), rateCoachCard);

export default router;

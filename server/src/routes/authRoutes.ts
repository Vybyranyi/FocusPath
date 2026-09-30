import { Router } from 'express';
import {
    changePassword,
    deleteAccount,
    exportAccount,
    forgotPassword,
    login,
    logout,
    me,
    refresh,
    register,
    resetPassword,
    updateProfile,
} from '@controllers/authController';
import { verifyTokenMiddleware } from '@middlewares/auth';
import { authLimiter, resetRequestLimiter } from '@middlewares/rateLimit';
import { validate } from '@middlewares/validate';
import {
    changePasswordSchema,
    deleteAccountSchema,
    forgotPasswordSchema,
    loginSchema,
    registerSchema,
    resetPasswordSchema,
    updateProfileSchema,
} from '@validation/authSchemas';

const router = Router();

router.post('/register', authLimiter, validate({ body: registerSchema }), register);
router.post('/login', authLimiter, validate({ body: loginSchema }), login);

// Forgotten passwords. The request has its own limiter: it always succeeds, so
// the credential limiter — which counts only failures — would never count it,
// and every call can send someone a mail.
router.post('/forgot-password', resetRequestLimiter, validate({ body: forgotPasswordSchema }), forgotPassword);
router.post('/reset-password', authLimiter, validate({ body: resetPasswordSchema }), resetPassword);

// Reads the refresh cookie itself; there is no access token by the time this
// is called, which is the entire point of it.
router.post('/refresh', refresh);
router.post('/logout', logout);

router.get('/me', verifyTokenMiddleware, me);
router.get('/export', verifyTokenMiddleware, exportAccount);
router.patch('/profile', verifyTokenMiddleware, validate({ body: updateProfileSchema }), updateProfile);
router.patch('/password', verifyTokenMiddleware, validate({ body: changePasswordSchema }), changePassword);
router.delete('/account', verifyTokenMiddleware, validate({ body: deleteAccountSchema }), deleteAccount);

export default router;

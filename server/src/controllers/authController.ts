import { Request, Response } from 'express';
import * as authService from '@services/authService';
import { created, ok } from '@utils/apiResponse';
import { clearSession, issueSession } from '@utils/cookies';
import { REFRESH_COOKIE } from '@config/auth';
import type { TypedRequest } from '@middlewares/validate';
import type {
    ChangePasswordDto,
    DeleteAccountDto,
    ForgotPasswordDto,
    LoginDto,
    RegisterDto,
    ResetPasswordDto,
    UpdateProfileDto,
} from '@validation/authSchemas';

// Handlers translate HTTP into a service call and back. The session lives in
// cookies rather than the response body, so nothing here hands a token to the
// client and no script can read one.

export const register = async (req: TypedRequest<RegisterDto>, res: Response) => {
    const session = await authService.register(req.body);
    issueSession(res, { ...session, userId: session.user.id });

    return created(res, { user: session.user });
};

export const login = async (req: TypedRequest<LoginDto>, res: Response) => {
    const session = await authService.login(req.body);
    issueSession(res, { ...session, userId: session.user.id });

    return ok(res, { user: session.user });
};

export const refresh = async (req: Request, res: Response) => {
    const session = await authService.refreshSession(req.cookies?.[REFRESH_COOKIE]);
    issueSession(res, { ...session, userId: session.user.id });

    return ok(res, { user: session.user });
};

export const logout = async (req: Request, res: Response) => {
    await authService.endSession(req.cookies?.[REFRESH_COOKIE]);
    clearSession(res);

    return ok(res, null);
};

export const me = async (req: Request, res: Response) =>
    ok(res, { user: await authService.getProfile(req.userId) });

export const updateProfile = async (req: TypedRequest<UpdateProfileDto>, res: Response) =>
    ok(res, { user: await authService.updateProfile(req.userId, req.body) });

export const changePassword = async (req: TypedRequest<ChangePasswordDto>, res: Response) => {
    const session = await authService.changePassword(req.userId, req.body);
    // Every other session is now void; this one is re-issued so the person who
    // just changed their password is not thrown out of the device they used.
    issueSession(res, { ...session, userId: session.user.id });

    return ok(res, null);
};

export const deleteAccount = async (req: TypedRequest<DeleteAccountDto>, res: Response) => {
    await authService.deleteAccount(req.userId, req.body);
    clearSession(res);

    return ok(res, null);
};

/** Always the same answer, so it cannot say whether an address has an account. */
export const forgotPassword = async (req: TypedRequest<ForgotPasswordDto>, res: Response) => {
    await authService.requestPasswordReset(req.body);

    return ok(res, null);
};

export const resetPassword = async (req: TypedRequest<ResetPasswordDto>, res: Response) => {
    const session = await authService.resetPassword(req.body);
    // Signed straight in: having just proved control of the inbox, being sent
    // to a login form to type the new password again is only friction.
    issueSession(res, { ...session, userId: session.user.id });

    return ok(res, { user: session.user });
};

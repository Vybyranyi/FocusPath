jest.mock('@services/mailService', () => ({ sendMail: jest.fn().mockResolvedValue(undefined) }));

import request from 'supertest';
import app from '@app';
import User from '@models/User';
import { sendMail } from '@services/mailService';
import { RESET_TTL_MS } from '@services/authService';
import { signUp, validUser } from '../testUtils';

const mailed = sendMail as jest.MockedFunction<typeof sendMail>;

/** The token out of the last link mailed, as the reset page would read it from the fragment. */
const lastToken = (): string => {
    const text = mailed.mock.calls[mailed.mock.calls.length - 1]?.[0].text ?? '';
    const match = text.match(/#token=([A-Za-z0-9_-]+)/);
    if (!match) throw new Error(`No reset link in: ${text}`);
    return match[1];
};

const forgot = (email: string) => request(app).post('/auth/forgot-password').send({ email });

const reset = (token: string, newPassword = 'a-brand-new-password') =>
    request(app).post('/auth/reset-password').send({ token, newPassword });

const login = (password: string) =>
    request(app).post('/auth/login').send({ email: validUser.email, password });

beforeEach(() => {
    mailed.mockClear();
});

describe('password reset', () => {
    describe('POST /auth/forgot-password', () => {
        it('mails a link to the account holder', async () => {
            await signUp();

            await forgot(validUser.email).expect(200);

            expect(mailed).toHaveBeenCalledTimes(1);
            expect(mailed.mock.calls[0][0].to).toBe(validUser.email);
            expect(mailed.mock.calls[0][0].text).toContain('/reset-password#token=');
        });

        /** The same reply either way, or this becomes a list of who has an account. */
        it('answers an unknown address exactly as it answers a known one', async () => {
            await signUp();

            const known = await forgot(validUser.email).expect(200);
            const unknown = await forgot('nobody@example.com').expect(200);

            expect(unknown.body).toEqual(known.body);
            expect(mailed).toHaveBeenCalledTimes(1);
        });

        it('finds the account whatever the case of the address', async () => {
            await signUp();

            await forgot(`  ${validUser.email.toUpperCase()} `).expect(200);

            expect(mailed).toHaveBeenCalledTimes(1);
        });

        /**
         * The fragment never reaches a server or a Referer, so the reset page
         * can load CDN images without handing the token over.
         */
        it('puts the token in the fragment, not the query', async () => {
            await signUp();

            await forgot(validUser.email).expect(200);

            expect(mailed.mock.calls[0][0].text).not.toMatch(/\?token=/);
        });

        /** A Host header is the sender's to choose; a link built from it is reset poisoning. */
        it('never builds the link from the Host header', async () => {
            await signUp();

            await forgot(validUser.email).set('Host', 'evil.example').expect(200);

            expect(mailed.mock.calls[0][0].text).not.toContain('evil.example');
        });

        it('stores only a hash of the token', async () => {
            await signUp();
            await forgot(validUser.email).expect(200);

            const stored = await User.findOne({ email: validUser.email }).select('+passwordResetHash');

            expect(stored?.passwordResetHash).toBeDefined();
            expect(stored?.passwordResetHash).not.toBe(lastToken());
        });

        it('never shows the reset fields in a response', async () => {
            const client = await signUp();
            await forgot(validUser.email).expect(200);

            const response = await client.agent.get('/auth/me').expect(200);

            expect(response.body.data.user).not.toHaveProperty('passwordResetHash');
            expect(response.body.data.user).not.toHaveProperty('passwordResetExpires');
        });

        it('refuses something that is not an address', async () => {
            await forgot('not-an-address').expect(400);
        });
    });

    describe('POST /auth/reset-password', () => {
        it('sets the new password and signs the person in', async () => {
            await signUp();
            await forgot(validUser.email).expect(200);

            const response = await reset(lastToken(), 'a-brand-new-password').expect(200);

            expect(response.body.data.user.email).toBe(validUser.email);
            expect(response.headers['set-cookie']).toEqual(
                expect.arrayContaining([expect.stringContaining('access_token=')]),
            );
            await login('a-brand-new-password').expect(200);
            await login(validUser.password).expect(401);
        });

        it('works once', async () => {
            await signUp();
            await forgot(validUser.email).expect(200);
            const token = lastToken();

            await reset(token).expect(200);
            const second = await reset(token, 'yet-another-password').expect(400);

            expect(second.body.error.message).toBe('This reset link is invalid or has expired');
        });

        it('refuses a token nobody was sent', async () => {
            await signUp();

            await reset('made-up-token').expect(400);
        });

        it('refuses a link past its time', async () => {
            await signUp();
            await forgot(validUser.email).expect(200);
            const token = lastToken();
            await User.updateOne(
                { email: validUser.email },
                { $set: { passwordResetExpires: new Date(Date.now() - 1000) } },
            );

            await reset(token).expect(400);
        });

        it('lasts half an hour', () => {
            expect(RESET_TTL_MS).toBe(30 * 60 * 1000);
        });

        it('retires an older link when a newer one is sent', async () => {
            await signUp();
            await forgot(validUser.email).expect(200);
            const older = lastToken();
            await forgot(validUser.email).expect(200);

            await reset(older).expect(400);
            await reset(lastToken()).expect(200);
        });

        /** A reset is what someone does when they think the account is not only theirs. */
        it('ends every other session', async () => {
            const client = await signUp();
            await forgot(validUser.email).expect(200);

            await reset(lastToken()).expect(200);

            await client.agent.post('/auth/refresh').set('X-CSRF-Token', client.csrf).expect(401);
        });

        it('holds the new password to the usual rules', async () => {
            await signUp();
            await forgot(validUser.email).expect(200);

            await reset(lastToken(), 'short').expect(400);
        });

        /** A link still in the inbox would otherwise undo a password change. */
        it('is retired by an ordinary password change', async () => {
            const client = await signUp();
            await forgot(validUser.email).expect(200);
            const token = lastToken();

            await client.agent
                .patch('/auth/password')
                .set('X-CSRF-Token', client.csrf)
                .send({ currentPassword: validUser.password, newPassword: 'changed-by-hand' })
                .expect(200);

            await reset(token).expect(400);
        });
    });
});

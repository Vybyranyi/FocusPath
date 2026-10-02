import { logger } from '@config/logger';
import { sendMail } from './mailService';

const mail = { to: 'ann@example.com', subject: 'Reset', text: 'https://app.example/reset-password#token=secret' };

describe('sendMail without SMTP_URL', () => {
    const env = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = env;
        jest.restoreAllMocks();
    });

    it('writes the message to the log outside production, so a link can be followed locally', async () => {
        const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);

        await sendMail(mail);

        expect(JSON.stringify(info.mock.calls)).toContain('#token=secret');
    });

    /** A reset link in a log is a way into the account for anyone who reads the log. */
    it('never logs the message in production', async () => {
        process.env.NODE_ENV = 'production';
        const info = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
        const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

        await sendMail(mail);

        expect(JSON.stringify([...info.mock.calls, ...error.mock.calls])).not.toContain('secret');
        expect(error).toHaveBeenCalled();
    });
});

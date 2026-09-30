import nodemailer, { type Transporter } from 'nodemailer';
import { logger } from '@config/logger';

export interface Mail {
    to: string;
    subject: string;
    text: string;
}

let transport: Transporter | null = null;

/**
 * Built on first use, like the OpenAI client: a missing SMTP_URL must not stop
 * the server starting, since only password reset ever sends mail.
 */
const getTransport = (): Transporter | null => {
    const url = process.env.SMTP_URL;
    if (!url) return null;
    if (!transport) transport = nodemailer.createTransport(url);
    return transport;
};

/**
 * Sends a message, or says plainly why it did not.
 *
 * With no SMTP_URL, development writes the message to the log instead — that
 * is how a reset link is followed on a laptop. Production never does: a reset
 * link in a log is a way into the account for anyone who can read the log, so
 * there it is an error that names the missing setting and nothing more.
 */
export const sendMail = async (mail: Mail): Promise<void> => {
    const smtp = getTransport();

    if (smtp) {
        await smtp.sendMail({
            from: process.env.MAIL_FROM ?? 'FocusPath <no-reply@focuspath.app>',
            ...mail,
        });
        return;
    }

    if (process.env.NODE_ENV === 'production') {
        logger.error({ subject: mail.subject }, 'Mail not sent: SMTP_URL is not configured');
        return;
    }

    logger.info({ to: mail.to, subject: mail.subject, text: mail.text }, 'Mail (not sent: no SMTP_URL, logged instead)');
};

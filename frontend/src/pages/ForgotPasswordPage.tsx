import Input from '@components/ui/Input';
import Button from '@components/ui/Button';
import { Link } from 'react-router';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useState } from 'react';
import { useAppDispatch } from '@store/hooks';
import { requestPasswordReset } from '@store/authSlice';

const validationSchema = Yup.object({
  email: Yup.string().trim().email('Invalid e-mail address').required('Required'),
});

/**
 * Asking for a reset link.
 *
 * The login page used to say "Password reset isn't available yet — ask an
 * admin", and there was no admin screen to ask: a forgotten password meant a
 * lost account, and with it every streak in it.
 *
 * The confirmation is worded for both cases on purpose. The server answers
 * the same whether or not the address has an account, and this page must not
 * undo that by saying anything different.
 */
export default function ForgotPasswordPage() {
  const dispatch = useAppDispatch();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="md:h-screen md:flex md:flex-col md:justify-center">
      <h1 className="display-5 text-center mt-6 mb-6 md:mt-0 md:mb-9">Reset your password</h1>

      <div className="page-gutter w-full">
        <div className="flex flex-col gap-4 md:max-w-110.5 md:mx-auto">
          {sentTo ? (
            <div role="status" className="flex flex-col gap-3">
              <p className="body-bold text-ink">Check your inbox</p>
              <p className="body-light text-ink-2">
                If an account exists for {sentTo}, a link to choose a new password is on
                its way. It works for 30 minutes.
              </p>
              <p className="alternative text-ink-muted">
                Nothing after a few minutes? Check your spam folder, or make sure the
                address is the one you signed up with.
              </p>
            </div>
          ) : (
            <Formik
              initialValues={{ email: '' }}
              validationSchema={validationSchema}
              onSubmit={async ({ email }) => {
                setError(null);
                try {
                  await dispatch(requestPasswordReset(email.trim())).unwrap();
                  setSentTo(email.trim());
                } catch (reason) {
                  setError(typeof reason === 'string' ? reason : 'Could not send the link');
                }
              }}
            >
              {({ values, errors, touched, handleChange, handleBlur, isValid, dirty, isSubmitting }) => (
                <Form className="flex flex-col gap-4">
                  <p className="body-light text-ink-2">
                    Enter the address you signed up with and we will mail you a link to
                    choose a new password.
                  </p>
                  <Input
                    label="Email"
                    placeholder="Enter your e-mail"
                    type="email"
                    value={values.email}
                    onChange={handleChange('email')}
                    onClear={() => handleChange('email')('')}
                    onBlur={handleBlur('email')}
                    error={touched.email ? errors.email : ''}
                  />
                  {error && (
                    <p role="alert" className="chip text-danger">
                      {error}
                    </p>
                  )}
                  <Button
                    type="primary"
                    size="large"
                    htmlType="submit"
                    disabled={!(isValid && dirty) || isSubmitting}
                  >
                    {isSubmitting ? 'Sending…' : 'Send reset link'}
                  </Button>
                </Form>
              )}
            </Formik>
          )}

          <Link to="/login" className="block body-bold text-accent text-center mt-2">
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}

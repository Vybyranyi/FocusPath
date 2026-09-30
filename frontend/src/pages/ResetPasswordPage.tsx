import Input from '@components/ui/Input';
import Button from '@components/ui/Button';
import { Link, useNavigate } from 'react-router';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useState } from 'react';
import { useAppDispatch } from '@store/hooks';
import { resetPassword } from '@store/authSlice';
import { useToast } from '@hooks/useToast';

const validationSchema = Yup.object({
  newPassword: Yup.string().min(8, 'At least 8 characters').required('Required'),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref('newPassword')], 'Passwords do not match')
    .required('Required'),
});

/**
 * Reads the token from the fragment once, then takes it out of the address
 * bar. It arrives in the fragment so no server and no Referer ever sees it;
 * leaving it there would still put a working credential in the browser's
 * history for as long as the link lives.
 */
const takeTokenFromFragment = (): string => {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }
  return token;
};

/** Choosing a new password from a mailed link. The server signs the person in. */
export default function ResetPasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [token] = useState(takeTokenFromFragment);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="md:h-screen md:flex md:flex-col md:justify-center">
      <h1 className="display-5 text-center mt-6 mb-6 md:mt-0 md:mb-9">Choose a new password</h1>

      <div className="page-gutter w-full">
        <div className="flex flex-col gap-4 md:max-w-110.5 md:mx-auto">
          {!token ? (
            <div role="alert" className="flex flex-col gap-3">
              <p className="body-bold text-ink">This link is incomplete</p>
              <p className="body-light text-ink-2">
                Open the link from the mail exactly as it came, or ask for a new one.
              </p>
              <Link to="/forgot-password" className="body-bold text-accent">
                Send a new link
              </Link>
            </div>
          ) : (
            <Formik
              initialValues={{ newPassword: '', confirmPassword: '' }}
              validationSchema={validationSchema}
              onSubmit={async ({ newPassword }) => {
                setError(null);
                try {
                  await dispatch(resetPassword({ token, newPassword })).unwrap();
                  notify('Password changed — you are signed in');
                  navigate('/main', { replace: true });
                } catch (reason) {
                  setError(typeof reason === 'string' ? reason : 'Could not change the password');
                }
              }}
            >
              {({ values, errors, touched, handleChange, handleBlur, isValid, dirty, isSubmitting }) => (
                <Form className="flex flex-col gap-4">
                  <Input
                    label="New password"
                    placeholder="At least 8 characters"
                    type="password"
                    value={values.newPassword}
                    onChange={handleChange('newPassword')}
                    onBlur={handleBlur('newPassword')}
                    error={touched.newPassword ? errors.newPassword : ''}
                  />
                  <Input
                    label="Repeat new password"
                    placeholder="Type it again"
                    type="password"
                    value={values.confirmPassword}
                    onChange={handleChange('confirmPassword')}
                    onBlur={handleBlur('confirmPassword')}
                    error={touched.confirmPassword ? errors.confirmPassword : ''}
                  />
                  <p className="alternative text-ink-muted">
                    Every other device signed in to this account will be signed out.
                  </p>
                  {error && (
                    <div role="alert" className="flex flex-col gap-1">
                      <p className="chip text-danger">{error}</p>
                      <Link to="/forgot-password" className="alternative text-accent">
                        Send a new link
                      </Link>
                    </div>
                  )}
                  <Button
                    type="primary"
                    size="large"
                    htmlType="submit"
                    disabled={!(isValid && dirty) || isSubmitting}
                  >
                    {isSubmitting ? 'Saving…' : 'Set new password'}
                  </Button>
                </Form>
              )}
            </Formik>
          )}
        </div>
      </div>
    </div>
  );
}

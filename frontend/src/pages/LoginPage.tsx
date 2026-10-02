import Input  from '@components/ui/Input';
import Button from '@components/ui/Button';
import { Link, useNavigate } from 'react-router';
import { Formik, Form } from 'formik';
import * as Yup from 'yup';
import { useAppDispatch, useAppSelector } from '@store/hooks';
import { loginUser } from '@store/authSlice';
import { useEffect } from 'react';

const validationSchema = Yup.object({
  email:    Yup.string().email('Invalid e-mail address').required('Required'),
  password: Yup.string().min(8, 'Password must be at least 8 characters').required('Required'),
});

export default function LoginPage() {
  const navigate  = useNavigate();
  const dispatch  = useAppDispatch();
  const { user, error, loading } = useAppSelector(state => state.auth);

  useEffect(() => {
    if (user) navigate('/main');
  }, [user, navigate]);

  return (
    /* Mobile: flex-col full height with fixed bottom button
       Desktop (≥768px): centered column */
    <div className="md:h-screen md:flex md:flex-col md:justify-center">
      <h1 className="display-5 hidden md:block text-center mb-9">Continue with E-mail</h1>

      <div className="page-gutter w-full">
        <Formik
          initialValues={{ email: '', password: '' }}
          validationSchema={validationSchema}
          onSubmit={values => { dispatch(loginUser(values)); }}
        >
          {({ values, errors, touched, handleChange, handleBlur, isValid, dirty }) => (
            <Form>
              <div className="flex flex-col gap-4 pt-2 md:pt-0 md:max-w-110.5 md:mx-auto md:mb-22.5">
                <Input
                  label="Email"
                  placeholder="Enter your e-mail"
                  type="email"
                  value={values.email}
                  onChange={handleChange('email')}
                  onClear={() => handleChange('email')("")}
                  onBlur={handleBlur('email')}
                  error={touched.email ? errors.email : ''}
                />
                <Input
                  label="Password"
                  placeholder="Enter your password"
                  type="password"
                  value={values.password}
                  onChange={handleChange('password')}
                  onClear={() => handleChange('password')("")}
                  onBlur={handleBlur('password')}
                  error={touched.password ? errors.password : ''}
                />
                {error && <p className="chip text-danger">{error}</p>}
                <Link to="/forgot-password" className="alternative text-accent self-start">
                  Forgot your password?
                </Link>
              </div>

              <div className="fixed bottom-3 left-6 right-6 md:static md:max-w-86.25 md:mx-auto">
                <Link
                  to="/register"
                  className="block body-bold text-accent text-center mb-6"
                >
                  Don't have an account? Create one
                </Link>
                <Button
                  type="primary"
                  size="large"
                  htmlType="submit"
                  disabled={!(isValid && dirty) || loading}
                >
                  {loading ? 'Loading...' : 'Login'}
                </Button>
              </div>
            </Form>
          )}
        </Formik>
      </div>
    </div>
  );
}

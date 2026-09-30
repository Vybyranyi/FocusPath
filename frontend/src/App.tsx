// Global styles are in src/index.css
import { fetchCurrentUser } from "@store/authSlice";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { useEffect, useState, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import Layout from "@components/layout/Layout";
import LoginPage from "@pages/LoginPage";
import RegisterPage from "@pages/RegisterPage";
import ForgotPasswordPage from "@pages/ForgotPasswordPage";
import ResetPasswordPage from "@pages/ResetPasswordPage";
import Main from "@pages/Main";
import CreateHabit from "@pages/CreateHabit";
import ProfilePage from "@pages/ProfilePage";
import StatsPage from "@pages/StatsPage";
import ExplorePage from "@pages/ExplorePage";
import PlanDetailPage from "@pages/PlanDetailPage";
import AppLoading from "@components/habit/AppLoading";
import ProtectedRoute from "@components/layout/ProtectedRoute";

function App() {
  const dispatch = useAppDispatch();
  const { user, loading } = useAppSelector((state) => state.auth);
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // The session lives in cookies the browser sends on its own, so there is
    // nothing to read locally — just ask who they belong to. A visitor with no
    // session gets a rejection, which is the normal path, not a failure.
    dispatch(fetchCurrentUser()).finally(() => setIsAppReady(true));
  }, [dispatch]);

  if (!isAppReady || (loading && !user)) {
    return <AppLoading />;
  }

  return (
    <Suspense fallback={<AppLoading />}>
      <Layout>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route
            path="/main/*"
            element={
              <ProtectedRoute>
                <Main />
              </ProtectedRoute>
            }
          />
          <Route
            path="/createhabit/*"
            element={
              <ProtectedRoute>
                <CreateHabit />
              </ProtectedRoute>
            }
          />
          {/* The only pair of routes outside ProtectedRoute. Reading the
              library needs no account — it is the one way a stranger can see
              what this app is at all; taking or publishing still does. */}
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/explore/:id" element={<PlanDetailPage />} />
          <Route
            path="/profile"
            element={
              <ProtectedRoute>
                <ProfilePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/stats"
            element={
              <ProtectedRoute>
                <StatsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="*"
            element={
              user ? (
                <Navigate to="/main" replace />
              ) : (
                <Navigate to="/login" replace />
              )
            }
          />
        </Routes>
      </Layout>
    </Suspense>
  );
}

export default App;

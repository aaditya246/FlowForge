import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import DashboardLayout from './layouts/DashboardLayout';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import WorkflowsPage from './pages/WorkflowsPage';
import WorkflowDetailPage from './pages/WorkflowDetailPage';
import WorkflowVersionEditPage from './pages/WorkflowVersionEditPage';
import RuleTesterPage from './pages/RuleTesterPage';
import RequestSubmissionPage from './pages/RequestSubmissionPage';
import RequestHistoryPage from './pages/RequestHistoryPage';
import ExecutionDetailPage from './pages/ExecutionDetailPage';
import FailureSimulationPage from './pages/FailureSimulationPage';
import ReliabilityDashboardPage from './pages/ReliabilityDashboardPage';
import ManualReviewPage from './pages/ManualReviewPage';
import ReviewDetailPage from './pages/ReviewDetailPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
            <Route path="/workflows/:id/versions/:version" element={<WorkflowVersionEditPage />} />
            <Route path="/rules/test" element={<RuleTesterPage />} />
            <Route path="/submit" element={<RequestSubmissionPage />} />
            <Route path="/requests" element={<RequestHistoryPage />} />
            <Route path="/executions/:id" element={<ExecutionDetailPage />} />
            <Route path="/reliability" element={<ReliabilityDashboardPage />} />
            <Route path="/simulation" element={<FailureSimulationPage />} />
            <Route path="/review" element={<ManualReviewPage />} />
            <Route path="/reviews/:id" element={<ReviewDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

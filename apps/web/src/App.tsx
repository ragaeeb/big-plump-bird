import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardProvider } from '@/context/dashboard-context';
import { AnalyticsRoute } from '@/routes/analytics-route';
import { DashboardLayout } from '@/routes/dashboard-layout';
import { JobQueueRoute } from '@/routes/job-queue-route';
import { NewJobRoute } from '@/routes/new-job-route';
import { RecentVideosRoute } from '@/routes/recent-videos-route';
import { SettingsRoute } from '@/routes/settings-route';
import { TranscriptionDetailRoute } from '@/routes/transcription-detail-route';
import { TranscriptionsRoute } from '@/routes/transcriptions-route';

export default function App() {
    return (
        <DashboardProvider>
            <Routes>
                <Route element={<DashboardLayout />} path="/">
                    <Route element={<Navigate replace to="/new-job" />} index />
                    <Route element={<NewJobRoute />} path="new-job" />
                    <Route element={<JobQueueRoute />} path="job-queue" />
                    <Route element={<RecentVideosRoute />} path="recent-videos" />
                    <Route element={<AnalyticsRoute />} path="analytics" />
                    <Route element={<SettingsRoute />} path="settings" />
                    <Route element={<TranscriptionsRoute />} path="transcriptions" />
                    <Route element={<TranscriptionDetailRoute />} path="transcriptions/:videoId" />
                    <Route element={<Navigate replace to="/new-job" />} path="*" />
                </Route>
            </Routes>
        </DashboardProvider>
    );
}

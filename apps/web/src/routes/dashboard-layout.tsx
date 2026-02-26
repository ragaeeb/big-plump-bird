import { IconCheck, IconFileWord, IconListDetails, IconVideo } from '@tabler/icons-react';
import type { CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { MetricCard } from '@/components/metric-card';
import { SiteHeader } from '@/components/site-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useDashboard } from '@/context/dashboard-context';
import { type AppView, VIEW_META } from '@/lib/views';

const VIEW_PATHS: Record<AppView, string> = {
    analytics: '/analytics',
    'job-queue': '/job-queue',
    'new-job': '/new-job',
    'recent-videos': '/recent-videos',
    transcriptions: '/transcriptions',
};

function toView(pathname: string): AppView {
    if (pathname.startsWith('/analytics')) {
        return 'analytics';
    }
    if (pathname.startsWith('/job-queue')) {
        return 'job-queue';
    }
    if (pathname.startsWith('/recent-videos')) {
        return 'recent-videos';
    }
    if (pathname.startsWith('/transcriptions')) {
        return 'transcriptions';
    }
    return 'new-job';
}

export function DashboardLayout() {
    const location = useLocation();
    const navigate = useNavigate();
    const { activeJobs, healthQuery, refreshAll, statsQuery } = useDashboard();
    const view = toView(location.pathname);
    const header = VIEW_META[view];
    const stats = statsQuery.data;
    const version = import.meta.env.VITE_BPB_VERSION;
    const repositoryUrl = import.meta.env.VITE_BPB_REPOSITORY_URL;
    const authorName = import.meta.env.VITE_BPB_AUTHOR_NAME;
    const authorUrl = import.meta.env.VITE_BPB_AUTHOR_URL;
    const showDashboardSummary = view !== 'transcriptions';
    // Analytics has its own section cards — skip the global metric grid there
    const showMetricCards = showDashboardSummary && view !== 'analytics';

    return (
        <SidebarProvider style={{ '--header-height': '3.75rem' } as CSSProperties}>
            <AppSidebar
                onRefresh={refreshAll}
                onViewChange={(nextView) => navigate(VIEW_PATHS[nextView])}
                queuedCount={activeJobs}
                transcriptCount={stats?.transcriptsTotal ?? 0}
                view={view}
            />
            <SidebarInset>
                {showDashboardSummary ? (
                    <SiteHeader onRefresh={refreshAll} subtitle={header.subtitle} title={header.title} />
                ) : null}
                <div className="flex flex-1 flex-col gap-4 p-4 md:p-6 bg-gradient-to-br from-background via-background to-muted/30">
                    {healthQuery.isError ? (
                        <Alert variant="destructive">
                            <AlertTitle>API is unreachable</AlertTitle>
                            <AlertDescription>
                                Dashboard data cannot load. Start API with `bun run api:dev` or `bun run dev:web`.
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    {showMetricCards ? (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
                            <MetricCard
                                icon={<IconListDetails className="size-4" />}
                                label="Active jobs"
                                value={String(activeJobs)}
                            />
                            <MetricCard
                                icon={<IconVideo className="size-4" />}
                                label="Recent videos"
                                value={String(stats?.videosTotal ?? 0)}
                            />
                            <MetricCard
                                icon={<IconFileWord className="size-4" />}
                                label="Transcriptions"
                                value={String(stats?.transcriptsTotal ?? 0)}
                            />
                            <MetricCard
                                icon={<IconCheck className="size-4" />}
                                label="Audio-backed transcripts"
                                value={String(stats?.audioBackedTranscripts ?? 0)}
                            />
                        </div>
                    ) : null}
                    <Outlet />
                    <footer className="text-muted-foreground mt-2 border-t pt-4 text-xs">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span>
                                Version:{' '}
                                {repositoryUrl ? (
                                    <a
                                        className="text-foreground underline decoration-dotted underline-offset-3"
                                        href={repositoryUrl}
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        {version}
                                    </a>
                                ) : (
                                    <span className="text-foreground">{version}</span>
                                )}
                            </span>
                            <span>
                                Author:{' '}
                                {authorUrl && authorName ? (
                                    <a
                                        className="text-foreground underline decoration-dotted underline-offset-3"
                                        href={authorUrl}
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        {authorName}
                                    </a>
                                ) : (
                                    <span className="text-foreground">{authorName || 'Unknown'}</span>
                                )}
                            </span>
                        </div>
                    </footer>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}

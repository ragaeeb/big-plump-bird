import { useQuery } from '@tanstack/react-query';
import { AnalyticsDataTable } from '@/components/analytics/analytics-data-table';
import { ChartAreaInteractive } from '@/components/analytics/chart-area-interactive';
import { ProcessingInsightsCharts } from '@/components/analytics/processing-insights-charts';
import { SectionCards } from '@/components/analytics/section-cards';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { getAnalytics } from '@/lib/api';

const QUERY_KEY = ['analytics'] as const;

export function AnalyticsRoute() {
    const analyticsQuery = useQuery({
        queryFn: getAnalytics,
        queryKey: QUERY_KEY,
        refetchInterval: 15_000,
    });

    if (analyticsQuery.isLoading) {
        return (
            <div className="@container/main flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
                    <Skeleton className="h-36 w-full rounded-xl" />
                    <Skeleton className="h-36 w-full rounded-xl" />
                    <Skeleton className="h-36 w-full rounded-xl" />
                    <Skeleton className="h-36 w-full rounded-xl" />
                </div>
                <Skeleton className="h-80 w-full rounded-xl" />
                <Skeleton className="h-72 w-full rounded-xl" />
            </div>
        );
    }

    if (analyticsQuery.isError || !analyticsQuery.data) {
        const errorMessage =
            analyticsQuery.error instanceof Error ? analyticsQuery.error.message : 'Failed to load analytics data.';
        const isNotFound = /not found|404/i.test(errorMessage);
        return (
            <Alert variant="destructive">
                <AlertTitle>Analytics unavailable</AlertTitle>
                <AlertDescription>
                    {isNotFound
                        ? 'Analytics endpoint is missing on the running API instance. Restart the API/dev server to load the latest backend routes.'
                        : errorMessage}
                </AlertDescription>
            </Alert>
        );
    }

    const analytics = analyticsQuery.data;

    return (
        <div className="@container/main flex flex-col gap-6">
            <SectionCards summary={analytics.summary} />
            <ChartAreaInteractive data={analytics.daily} />
            <ProcessingInsightsCharts analytics={analytics} />
            <AnalyticsDataTable analytics={analytics} />
        </div>
    );
}

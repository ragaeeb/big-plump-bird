import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { getHealth, getJobs, getOptions, getRecentVideos, getStats } from '@/lib/api';

const QUERY_KEYS = {
    health: ['health'] as const,
    jobs: ['jobs'] as const,
    options: ['options'] as const,
    stats: ['stats'] as const,
    videos: ['videos'] as const,
};

function useDashboardData() {
    const queryClient = useQueryClient();

    const optionsQuery = useQuery({
        queryFn: getOptions,
        queryKey: QUERY_KEYS.options,
        staleTime: 60_000,
    });
    const jobsQuery = useQuery({
        queryFn: getJobs,
        queryKey: QUERY_KEYS.jobs,
        refetchInterval: 2_000,
    });
    const videosQuery = useQuery({
        queryFn: getRecentVideos,
        queryKey: QUERY_KEYS.videos,
        refetchInterval: 5_000,
    });
    const statsQuery = useQuery({
        queryFn: getStats,
        queryKey: QUERY_KEYS.stats,
        refetchInterval: 5_000,
    });
    const healthQuery = useQuery({
        queryFn: getHealth,
        queryKey: QUERY_KEYS.health,
        refetchInterval: 10_000,
        retry: 1,
    });

    const activeJobs = useMemo(() => {
        const jobs = jobsQuery.data ?? [];
        return jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;
    }, [jobsQuery.data]);

    const refreshAll = () => {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.jobs });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.videos });
        void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.stats });
    };

    return {
        activeJobs,
        healthQuery,
        jobsQuery,
        optionsQuery,
        refreshAll,
        statsQuery,
        videosQuery,
    };
}

export type DashboardContextValue = ReturnType<typeof useDashboardData>;

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
    const value = useDashboardData();
    return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
    const context = useContext(DashboardContext);
    if (!context) {
        throw new Error('useDashboard must be used within DashboardProvider.');
    }
    return context;
}

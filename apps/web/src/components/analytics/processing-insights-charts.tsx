import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { AnalyticsPayload } from '@/lib/api';

const COLORS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-3)', 'var(--color-chart-4)'];

const durationConfig = {
    count: { color: 'var(--color-chart-2)', label: 'Videos' },
} satisfies ChartConfig;

const jobTimeConfig = {
    totalMinutes: { color: 'var(--color-chart-3)', label: 'Total minutes' },
} satisfies ChartConfig;

const enhancementTimingConfig = {
    analysisSeconds: { color: 'var(--color-chart-2)', label: 'Analysis seconds' },
    processingSeconds: { color: 'var(--color-chart-1)', label: 'Processing seconds' },
} satisfies ChartConfig;

const speechSnrConfig = {
    snrDb: { color: 'var(--color-chart-2)', label: 'SNR (dB)' },
    speechRatioPct: { color: 'var(--color-chart-1)', label: 'Speech ratio (%)' },
} satisfies ChartConfig;

const signalNoiseConfig = {
    value: { color: 'var(--color-chart-4)', label: 'Share (%)' },
} satisfies ChartConfig;

export function ProcessingInsightsCharts({ analytics }: { analytics: AnalyticsPayload }) {
    const jobDurationSeries = analytics.jobDurations.map((point, index) => ({
        index: String(index + 1),
        label: point.label,
        totalMinutes: round2(point.totalMs / 60000),
        videoId: point.videoId,
    }));

    const enhancementTimingSeries = analytics.enhancementMetrics
        .filter((point) => point.analysisDurationMs !== null || point.processingMs !== null)
        .map((point, index) => ({
            analysisSeconds: point.analysisDurationMs ? round2(point.analysisDurationMs / 1000) : 0,
            index: String(index + 1),
            processingSeconds: point.processingMs ? round2(point.processingMs / 1000) : 0,
            runId: point.runId,
            videoId: point.videoId,
        }));

    const speechSnrSeries = analytics.enhancementMetrics
        .filter((point) => point.snrDb !== null || point.speechRatio !== null)
        .map((point, index) => ({
            index: String(index + 1),
            runId: point.runId,
            snrDb: point.snrDb ?? null,
            speechRatioPct: point.speechRatio !== null ? round2(point.speechRatio * 100) : null,
            videoId: point.videoId,
        }));

    return (
        <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Processed Audio Duration Buckets</CardTitle>
                        <CardDescription>How long the source media durations are.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {analytics.durationBuckets.length === 0 ? (
                            <EmptyChartLabel label="No duration data yet." />
                        ) : (
                            <ChartContainer className="h-[260px] w-full" config={durationConfig}>
                                <BarChart data={analytics.durationBuckets}>
                                    <CartesianGrid vertical={false} />
                                    <XAxis dataKey="key" tickLine={false} />
                                    <YAxis allowDecimals={false} tickLine={false} width={36} />
                                    <ChartTooltip content={<ChartTooltipContent />} cursor={false} />
                                    <Bar dataKey="count" fill="var(--color-count)" radius={4} />
                                </BarChart>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Total Time Per Job</CardTitle>
                        <CardDescription>Wall-clock minutes from video row create to last update.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {jobDurationSeries.length === 0 ? (
                            <EmptyChartLabel label="No job timing data yet." />
                        ) : (
                            <ChartContainer className="h-[260px] w-full" config={jobTimeConfig}>
                                <BarChart data={jobDurationSeries}>
                                    <CartesianGrid vertical={false} />
                                    <XAxis dataKey="index" tickLine={false} />
                                    <YAxis allowDecimals={false} tickLine={false} width={48} />
                                    <ChartTooltip
                                        content={<ChartTooltipContent />}
                                        cursor={false}
                                        labelFormatter={(_, payload) =>
                                            payload?.[0]
                                                ? `${payload[0].payload.label} (${payload[0].payload.videoId})`
                                                : ''
                                        }
                                    />
                                    <Bar dataKey="totalMinutes" fill="var(--color-totalMinutes)" radius={4} />
                                </BarChart>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 @4xl/main:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Enhancement Timing Metrics</CardTitle>
                        <CardDescription>
                            `analysis_duration_ms` and `processing_ms` from `metrics_json`.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {enhancementTimingSeries.length === 0 ? (
                            <EmptyChartLabel label="No enhancement timing metrics yet." />
                        ) : (
                            <ChartContainer className="h-[280px] w-full" config={enhancementTimingConfig}>
                                <ComposedChart data={enhancementTimingSeries}>
                                    <CartesianGrid vertical={false} />
                                    <XAxis dataKey="index" tickLine={false} />
                                    <YAxis allowDecimals={false} tickLine={false} width={48} />
                                    <ChartTooltip
                                        content={<ChartTooltipContent />}
                                        labelFormatter={(_, payload) =>
                                            payload?.[0]
                                                ? `Run ${payload[0].payload.runId} (${payload[0].payload.videoId})`
                                                : ''
                                        }
                                    />
                                    <Bar dataKey="analysisSeconds" fill="var(--color-analysisSeconds)" radius={4} />
                                    <Line
                                        dataKey="processingSeconds"
                                        dot={false}
                                        stroke="var(--color-processingSeconds)"
                                        strokeWidth={3}
                                        type="monotone"
                                    />
                                </ComposedChart>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Speech Ratio vs SNR</CardTitle>
                        <CardDescription>Compare `speech_ratio` with `snr_db` per enhancement run.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {speechSnrSeries.length === 0 ? (
                            <EmptyChartLabel label="No speech ratio/SNR metrics yet." />
                        ) : (
                            <ChartContainer className="h-[220px] w-full" config={speechSnrConfig}>
                                <ComposedChart data={speechSnrSeries}>
                                    <CartesianGrid vertical={false} />
                                    <XAxis dataKey="index" tickLine={false} />
                                    <YAxis domain={[0, 100]} tickLine={false} width={44} yAxisId="speech" />
                                    <YAxis
                                        allowDecimals={false}
                                        orientation="right"
                                        tickLine={false}
                                        width={40}
                                        yAxisId="snr"
                                    />
                                    <ChartTooltip
                                        content={<ChartTooltipContent />}
                                        labelFormatter={(_, payload) =>
                                            payload?.[0]
                                                ? `Run ${payload[0].payload.runId} (${payload[0].payload.videoId})`
                                                : ''
                                        }
                                    />
                                    <Line
                                        dataKey="speechRatioPct"
                                        dot={false}
                                        stroke="var(--color-speechRatioPct)"
                                        strokeWidth={3}
                                        type="monotone"
                                        yAxisId="speech"
                                    />
                                    <Line
                                        dataKey="snrDb"
                                        dot={false}
                                        stroke="var(--color-snrDb)"
                                        strokeDasharray="5 5"
                                        strokeWidth={2}
                                        type="monotone"
                                        yAxisId="snr"
                                    />
                                </ComposedChart>
                            </ChartContainer>
                        )}
                        {analytics.signalNoiseShare.length === 0 ? (
                            <EmptyChartLabel label="No signal/noise split available." />
                        ) : (
                            <ChartContainer className="h-[220px] w-full" config={signalNoiseConfig}>
                                <PieChart>
                                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                                    <Pie
                                        data={analytics.signalNoiseShare}
                                        dataKey="value"
                                        innerRadius={52}
                                        nameKey="key"
                                        outerRadius={92}
                                    >
                                        {analytics.signalNoiseShare.map((entry, index) => (
                                            <Cell
                                                fill={COLORS[index % COLORS.length]}
                                                key={`${entry.key}-${entry.value}`}
                                            />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ChartContainer>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function EmptyChartLabel({ label }: { label: string }) {
    return <div className="text-muted-foreground flex h-[220px] items-center justify-center text-sm">{label}</div>;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

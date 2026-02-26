import { IconChartBar, IconClock, IconFileWord, IconTrendingUp, IconVideo } from '@tabler/icons-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import type { AnalyticsSummary } from '@/lib/api';

export function SectionCards({ summary }: { summary: AnalyticsSummary }) {
    return (
        <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            <Card className="@container/card">
                <CardHeader>
                    <CardDescription>Total Transcripts</CardDescription>
                    <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {summary.transcriptsTotal.toLocaleString()}
                    </CardTitle>
                    <CardAction>
                        <Badge variant="outline">
                            <IconFileWord className="size-3" />
                            All time
                        </Badge>
                    </CardAction>
                </CardHeader>
                <CardFooter className="flex-col items-start gap-1.5 text-sm">
                    <div className="line-clamp-1 flex gap-2 font-medium">
                        Completed transcriptions <IconTrendingUp className="size-4" />
                    </div>
                    <div className="text-muted-foreground">Across all ingested sources</div>
                </CardFooter>
            </Card>

            <Card className="@container/card">
                <CardHeader>
                    <CardDescription>Total Videos</CardDescription>
                    <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {summary.videosTotal.toLocaleString()}
                    </CardTitle>
                    <CardAction>
                        <Badge variant="outline">
                            <IconVideo className="size-3" />
                            Ingested
                        </Badge>
                    </CardAction>
                </CardHeader>
                <CardFooter className="flex-col items-start gap-1.5 text-sm">
                    <div className="line-clamp-1 flex gap-2 font-medium">
                        Media items processed <IconTrendingUp className="size-4" />
                    </div>
                    <div className="text-muted-foreground">Files and URLs combined</div>
                </CardFooter>
            </Card>

            <Card className="@container/card">
                <CardHeader>
                    <CardDescription>Transcribed Hours</CardDescription>
                    <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {summary.transcribedHours.toLocaleString()}
                    </CardTitle>
                    <CardAction>
                        <Badge variant="outline">
                            <IconClock className="size-3" />
                            Hours
                        </Badge>
                    </CardAction>
                </CardHeader>
                <CardFooter className="flex-col items-start gap-1.5 text-sm">
                    <div className="line-clamp-1 flex gap-2 font-medium">
                        Total audio processed <IconTrendingUp className="size-4" />
                    </div>
                    <div className="text-muted-foreground">Approximate processed audio</div>
                </CardFooter>
            </Card>

            <Card className="@container/card">
                <CardHeader>
                    <CardDescription>Avg / Day (last 7)</CardDescription>
                    <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                        {summary.averagePerDayLast7.toLocaleString()}
                    </CardTitle>
                    <CardAction>
                        <Badge variant="outline">
                            <IconChartBar className="size-3" />
                            7-day avg
                        </Badge>
                    </CardAction>
                </CardHeader>
                <CardFooter className="flex-col items-start gap-1.5 text-sm">
                    <div className="line-clamp-1 flex gap-2 font-medium">
                        Transcripts per day <IconTrendingUp className="size-4" />
                    </div>
                    <div className="text-muted-foreground">Rolling weekly throughput</div>
                </CardFooter>
            </Card>
        </div>
    );
}

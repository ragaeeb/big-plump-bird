import type { ReactNode } from 'react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <Card className="@container/card border-border/60 shadow-xs transition-shadow hover:shadow-sm">
            <CardHeader className="pb-4">
                <div className="flex items-start justify-between gap-2">
                    <CardDescription className="text-xs font-medium tracking-wide uppercase">{label}</CardDescription>
                    <div className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                        {icon}
                    </div>
                </div>
                <CardTitle className="text-2xl font-semibold tabular-nums @[240px]/card:text-3xl">{value}</CardTitle>
            </CardHeader>
        </Card>
    );
}

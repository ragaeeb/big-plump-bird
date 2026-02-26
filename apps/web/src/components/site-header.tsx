import { IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

type SiteHeaderProps = {
    title: string;
    subtitle: string;
    onRefresh: () => void;
};

export function SiteHeader({ onRefresh, subtitle, title }: SiteHeaderProps) {
    return (
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur-sm transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
            <div className="flex w-full items-center gap-2 px-4 lg:px-6">
                <SidebarTrigger className="-ml-1" />
                <Separator className="mx-1 data-[orientation=vertical]:h-4" orientation="vertical" />
                <div className="min-w-0">
                    <h1 className="brand-secondary-text truncate text-base font-semibold">{title}</h1>
                    <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
                </div>
                <div className="ml-auto">
                    <Button className="gap-1.5" onClick={onRefresh} size="sm" variant="outline">
                        <IconRefresh className="size-4" />
                        Refresh
                    </Button>
                </div>
            </div>
        </header>
    );
}
